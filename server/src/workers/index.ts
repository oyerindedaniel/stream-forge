import { Worker, Job } from 'bullmq';
import { VIDEO_PROCESSING_QUEUE, VideoJobData } from '../lib/queue';
import { redisConnection } from '../lib/redis';
import { videos, segments } from '../db/schema';
import { db } from '../db';
import { eq } from 'drizzle-orm';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { storage } from '../lib/storage';
import { promisify } from 'util';

const stat = promisify(fs.stat);

const TMP_DIR = path.join(process.cwd(), 'tmp');
if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
}

interface QualityConfig {
    name: string;
    height: number;
    bitrate: string;
    audioBitrate: string;
}

const QUALITIES: QualityConfig[] = [
    { name: '360p', height: 360, bitrate: '800k', audioBitrate: '96k' },
    { name: '720p', height: 720, bitrate: '2500k', audioBitrate: '128k' },
    { name: '1080p', height: 1080, bitrate: '5000k', audioBitrate: '192k' },
];

export const worker = new Worker<VideoJobData>(VIDEO_PROCESSING_QUEUE, async (job: Job) => {
    console.log(`[Worker] Processing video job ${job.id} for videoId: ${job.data.videoId}`);
    const { videoId, sourceUrl } = job.data;

    try {
        await db.update(videos).set({ status: 'processing' }).where(eq(videos.id, videoId));

        const sourcePath = path.join(TMP_DIR, `${videoId}_source.mp4`);
        const outputDir = path.join(TMP_DIR, videoId);
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

        // Download from S3
        if (!fs.existsSync(sourcePath)) {
            console.log(`[Worker] Downloading from S3: ${sourceUrl}`);
            const s3Key = sourceUrl.replace('s3://' + storage.bucketName + '/', '');

            const { GetObjectCommand } = await import('@aws-sdk/client-s3');
            const command = new GetObjectCommand({
                Bucket: storage.bucketName,
                Key: s3Key,
            });

            const response = await storage.s3Client.send(command);
            const writeStream = fs.createWriteStream(sourcePath);

            await new Promise<void>((resolve, reject) => {
                if (response.Body) {
                    const body = response.Body as NodeJS.ReadableStream;
                    body.pipe(writeStream);
                    writeStream.on('finish', resolve);
                    writeStream.on('error', reject);
                } else {
                    reject(new Error('No body in S3 response'));
                }
            });

            console.log('[Worker] Download complete');
        }

        // Probe file
        const probeData = await new Promise<ffmpeg.FfprobeData>((resolve, reject) => {
            ffmpeg.ffprobe(sourcePath, (err, data) => {
                if (err) reject(err);
                else resolve(data);
            });
        });

        const videoStream = probeData.streams.find(s => s.codec_type === 'video');
        const duration = probeData.format.duration || 0;
        const sourceWidth = videoStream?.width || 1920;
        const sourceHeight = videoStream?.height || 1080;

        console.log(`[Worker] Source: ${sourceWidth}x${sourceHeight}, duration: ${duration}s`);

        // Filter qualities based on source resolution
        const applicableQualities = QUALITIES.filter(q => q.height <= sourceHeight);
        if (applicableQualities.length === 0) {
            applicableQualities.push(QUALITIES[0]); // Always have at least 360p
        }

        const qualityManifests: Record<string, unknown>[] = [];

        // Process each quality
        for (const quality of applicableQualities) {
            console.log(`[Worker] Transcoding ${quality.name}...`);
            const qualityDir = path.join(outputDir, quality.name);
            if (!fs.existsSync(qualityDir)) fs.mkdirSync(qualityDir, { recursive: true });

            // Transcode with DASH segmentation
            await new Promise<void>((resolve, reject) => {
                ffmpeg(sourcePath)
                    .outputOptions([
                        '-map 0',
                        `-vf scale=-2:${quality.height}`,
                        '-c:v libx264', '-preset fast', '-crf 23',
                        `-b:v ${quality.bitrate}`,
                        '-c:a aac', `-b:a ${quality.audioBitrate}`,
                        '-g 48', '-keyint_min 48', '-sc_threshold 0',
                        '-f dash',
                        '-init_seg_name init.mp4',
                        '-media_seg_name seg_$Number$.m4s',
                        '-use_template 0',
                        '-use_timeline 1',
                        '-seg_duration 4',
                        '-adaptation_sets "id=0,streams=v id=1,streams=a"'
                    ])
                    .output(path.join(qualityDir, 'manifest.mpd'))
                    .on('end', () => resolve())
                    .on('error', reject)
                    .run();
            });

            // Build segment list
            const files = fs.readdirSync(qualityDir);
            const segmentFiles = files.filter(f => f.startsWith('seg_') && f.endsWith('.m4s')).sort((a, b) => {
                const numA = parseInt(a.match(/seg_(\d+)/)?.[1] || '0');
                const numB = parseInt(b.match(/seg_(\d+)/)?.[1] || '0');
                return numA - numB;
            });

            qualityManifests.push({
                quality: quality.name,
                height: quality.height,
                bitrate: quality.bitrate,
                codec: 'video/mp4; codecs="avc1.64001f, mp4a.40.2"',
                initSegmentUrl: `${quality.name}/init.mp4`,
                segments: segmentFiles.map((f, i) => ({
                    url: `${quality.name}/${f}`,
                    start: i * 4,
                    duration: 4,
                    index: i
                }))
            });

            console.log(`[Worker] ${quality.name} done: ${segmentFiles.length} segments`);
        }

        // Generate thumbnails (from highest quality)
        console.log('[Worker] Generating thumbnails...');
        const thumbDir = path.join(outputDir, 'thumbnails');
        if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });

        await new Promise<void>((resolve, reject) => {
            ffmpeg(sourcePath)
                .outputOptions([
                    '-vf fps=1/4,scale=320:-1',
                    '-q:v 2'
                ])
                .output(path.join(thumbDir, 'thumb_%03d.jpg'))
                .on('end', () => resolve())
                .on('error', reject)
                .run();
        });

        // Build master manifest
        const manifest = {
            videoId,
            duration,
            width: sourceWidth,
            height: sourceHeight,
            qualities: qualityManifests,
            thumbnails: {
                pattern: 'thumbnails/thumb_%03d.jpg',
                interval: 4
            }
        };

        fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

        // Upload all files to S3
        console.log('[Worker] Uploading to S3...');
        const { PutObjectCommand } = await import('@aws-sdk/client-s3');

        const allFiles: string[] = ['manifest.json'];

        // Add quality files
        for (const quality of applicableQualities) {
            const qualityDir = path.join(outputDir, quality.name);
            const qualityFiles = fs.readdirSync(qualityDir);
            allFiles.push(...qualityFiles.map(f => `${quality.name}/${f}`));
        }

        // Add thumbnails
        const thumbFiles = fs.readdirSync(path.join(outputDir, 'thumbnails'));
        allFiles.push(...thumbFiles.map(f => `thumbnails/${f}`));

        for (const file of allFiles) {
            const filePath = path.join(outputDir, file);
            if (fs.existsSync(filePath)) {
                const fileContent = fs.readFileSync(filePath);
                const s3Key = `processed/${videoId}/${file}`;

                const command = new PutObjectCommand({
                    Bucket: storage.bucketName,
                    Key: s3Key,
                    Body: fileContent,
                    ContentType: file.endsWith('.json') ? 'application/json' :
                        file.endsWith('.jpg') ? 'image/jpeg' : 'video/mp4'
                });

                await storage.s3Client.send(command);
            }
        }

        // Save segments to database
        const allSegments: Array<{
            videoId: string;
            idx: number;
            url: string;
            start: number;
            duration: number;
        }> = [];

        qualityManifests.forEach((qm) => {
            const segments = qm.segments as Array<{ url: string; start: number; duration: number; index: number }>;
            segments.forEach(seg => {
                allSegments.push({
                    videoId,
                    idx: seg.index,
                    url: seg.url,
                    start: seg.start,
                    duration: seg.duration
                });
            });
        });

        if (allSegments.length > 0) {
            await db.insert(segments).values(allSegments);
        }

        // Update video record
        await db.update(videos).set({
            status: 'ready',
            manifestUrl: `files/${videoId}/manifest.json`,
            width: sourceWidth,
            height: sourceHeight,
            duration: duration,
            thumbnails: { pattern: `files/${videoId}/thumbnails/thumb_%03d.jpg`, interval: 4 }
        }).where(eq(videos.id, videoId));

        console.log('[Worker] Job finished successfully');

    } catch (err) {
        console.error('[Worker] Job failed:', err);
        await db.update(videos).set({
            status: 'failed',
            lastError: err instanceof Error ? err.message : 'Unknown error'
        }).where(eq(videos.id, videoId));
        throw err;
    }

}, {
    connection: redisConnection
});
