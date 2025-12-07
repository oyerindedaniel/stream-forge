import { FastifyInstance } from 'fastify';
import { db } from '../../db';
import { videos } from '../../db/schema';
import { storage } from '../../lib/storage';
import { videoQueue } from '../../lib/queue';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export async function uploadRoutes(fastify: FastifyInstance) {

    // 1. Initiate Upload (with multipart support for large files)
    fastify.post('/', async (request, reply) => {
        const { filename, contentType, size, metadata } = request.body as {
            filename: string;
            contentType: string;
            size: number;
            metadata?: Record<string, unknown>
        };

        const videoId = randomUUID();
        const key = `uploads/${videoId}/${filename}`;

        // For files > 100MB, use multipart upload
        const useMultipart = size > 100 * 1024 * 1024;

        if (useMultipart) {
            const multipartCommand = new CreateMultipartUploadCommand({
                Bucket: storage.bucketName,
                Key: key,
                ContentType: contentType,
            });

            const multipartUpload = await storage.s3Client.send(multipartCommand);

            const partSize = 50 * 1024 * 1024; // 50MB parts
            const numParts = Math.ceil(size / partSize);

            const partUrls: string[] = [];
            for (let partNumber = 1; partNumber <= numParts; partNumber++) {
                const uploadPartCommand = new UploadPartCommand({
                    Bucket: storage.bucketName,
                    Key: key,
                    PartNumber: partNumber,
                    UploadId: multipartUpload.UploadId!,
                });

                const signedUrl = await getSignedUrl(storage.s3Client, uploadPartCommand, { expiresIn: 3600 });
                partUrls.push(signedUrl);
            }

            await db.insert(videos).values({
                id: videoId,
                title: (metadata?.title as string | undefined) || filename,
                status: 'pending_upload',
                sourceUrl: `s3://${storage.bucketName}/${key}`,
            });

            return {
                uploadId: videoId,
                multipartUploadId: multipartUpload.UploadId,
                partUrls,
                partSize,
                expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
            };
        } else {
            const uploadUrl = await storage.getUploadUrl(key, contentType);

            await db.insert(videos).values({
                id: videoId,
                title: (metadata?.title as string | undefined) || filename,
                status: 'pending_upload',
                sourceUrl: `s3://${storage.bucketName}/${key}`,
            });

            return {
                uploadId: videoId,
                uploadUrl,
                expiresAt: new Date(Date.now() + 3600 * 1000).toISOString()
            };
        }
    });

    // 2. Complete Upload
    fastify.post('/:uploadId/complete', async (request, reply) => {
        const { uploadId } = request.params as { uploadId: string };
        const { multipartUploadId, parts } = request.body as {
            multipartUploadId?: string;
            parts?: { PartNumber: number; ETag: string }[];
        };

        const video = await db.select().from(videos).where(eq(videos.id, uploadId)).limit(1);
        if (!video || video.length === 0) {
            return reply.status(404).send({ error: 'Video not found' });
        }

        const videoData = video[0];

        if (multipartUploadId && parts) {
            const s3Key = videoData.sourceUrl!.replace(`s3://${storage.bucketName}/`, '');

            const completeCommand = new CompleteMultipartUploadCommand({
                Bucket: storage.bucketName,
                Key: s3Key,
                UploadId: multipartUploadId,
                MultipartUpload: {
                    Parts: parts,
                },
            });

            await storage.s3Client.send(completeCommand);
        }

        await db.update(videos)
            .set({ status: 'processing', updatedAt: new Date() })
            .where(eq(videos.id, uploadId));

        await videoQueue.add('transcode', {
            videoId: videoData.id,
            sourceUrl: videoData.sourceUrl!
        });

        return {
            videoId: videoData.id,
            status: 'processing',
        };
    });

    // 3. Get Upload Progress
    fastify.get('/:uploadId/status', async (request, reply) => {
        const { uploadId } = request.params as { uploadId: string };

        const video = await db.select().from(videos).where(eq(videos.id, uploadId)).limit(1);
        if (!video || video.length === 0) {
            return reply.status(404).send({ error: 'Video not found' });
        }

        return {
            videoId: video[0].id,
            status: video[0].status,
            title: video[0].title,
        };
    });

    // 4. Cancel Upload
    fastify.delete('/:uploadId', async (request, reply) => {
        const { uploadId } = request.params as { uploadId: string };

        const video = await db.select().from(videos).where(eq(videos.id, uploadId)).limit(1);
        if (!video || video.length === 0) {
            return reply.status(404).send({ error: 'Video not found' });
        }

        await db.update(videos)
            .set({ status: 'cancelled' })
            .where(eq(videos.id, uploadId));

        return { success: true };
    });
}
