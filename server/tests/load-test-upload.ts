import { randomBytes } from 'crypto';
import fetch from 'node-fetch';

const API_URL = process.env.API_URL || 'http://localhost:3001';
const CONCURRENT_UPLOADS = parseInt(process.env.CONCURRENT_UPLOADS || '10');
const FILE_SIZE_MB = parseInt(process.env.FILE_SIZE_MB || '100');

interface UploadMetrics {
    filename: string;
    startTime: number;
    endTime?: number;
    duration?: number;
    uploadId?: string;
    success: boolean;
    error?: string;
}

async function simulateChunkedUpload(fileIndex: number): Promise<UploadMetrics> {
    const filename = `load-test-video-${fileIndex}.mp4`;
    const fileSizeBytes = FILE_SIZE_MB * 1024 * 1024;
    const chunkSize = 10 * 1024 * 1024; // 10MB chunks

    const metrics: UploadMetrics = {
        filename,
        startTime: Date.now(),
        success: false,
    };

    try {
        // 1. Initialize upload
        const initResponse = await fetch(`${API_URL}/api/v1/uploads`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename,
                contentType: 'video/mp4',
                size: fileSizeBytes,
                metadata: { title: `Load Test Video ${fileIndex}` },
            }),
        });

        if (!initResponse.ok) {
            throw new Error(`Init failed: ${initResponse.statusText}`);
        }

        const initData = (await initResponse.json()) as {
            uploadId: string;
            partUrls?: string[];
            uploadUrl?: string;
        };
        metrics.uploadId = initData.uploadId;

        // 2. Simulate chunk uploads
        if (initData.partUrls) {
            // Multipart upload
            for (let i = 0; i < initData.partUrls.length; i++) {
                const chunkData = randomBytes(Math.min(chunkSize, fileSizeBytes - i * chunkSize));

                const uploadResponse = await fetch(initData.partUrls[i], {
                    method: 'PUT',
                    body: chunkData,
                    headers: {
                        'Content-Type': 'video/mp4',
                    },
                });

                if (!uploadResponse.ok) {
                    throw new Error(`Chunk ${i} upload failed: ${uploadResponse.statusText}`);
                }
            }
        } else if (initData.uploadUrl) {
            // Single upload
            const fileData = randomBytes(fileSizeBytes);
            const uploadResponse = await fetch(initData.uploadUrl, {
                method: 'PUT',
                body: fileData,
                headers: {
                    'Content-Type': 'video/mp4',
                },
            });

            if (!uploadResponse.ok) {
                throw new Error(`Upload failed: ${uploadResponse.statusText}`);
            }
        }

        // 3. Complete upload
        const completeResponse = await fetch(
            `${API_URL}/api/v1/uploads/${initData.uploadId}/complete`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            }
        );

        if (!completeResponse.ok) {
            throw new Error(`Complete failed: ${completeResponse.statusText}`);
        }

        metrics.endTime = Date.now();
        metrics.duration = metrics.endTime - metrics.startTime;
        metrics.success = true;

        return metrics;
    } catch (error) {
        metrics.endTime = Date.now();
        metrics.duration = metrics.endTime - metrics.startTime;
        metrics.error = error instanceof Error ? error.message : 'Unknown error';
        return metrics;
    }
}

async function main() {
    console.log('🚀 Upload Load Testing\n');
    console.log(`Target: ${API_URL}`);
    console.log(`Concurrent Uploads: ${CONCURRENT_UPLOADS}`);
    console.log(`File Size: ${FILE_SIZE_MB}MB`);
    console.log(`Started: ${new Date().toISOString()}\n`);

    const startTime = Date.now();

    // Run concurrent uploads
    const uploadPromises: Promise<UploadMetrics>[] = [];
    for (let i = 0; i < CONCURRENT_UPLOADS; i++) {
        uploadPromises.push(simulateChunkedUpload(i));
    }

    console.log(`Simulating ${CONCURRENT_UPLOADS} concurrent uploads...\n`);

    const results = await Promise.allSettled(uploadPromises);
    const endTime = Date.now();
    const totalDuration = endTime - startTime;

    // Analyze results
    const metrics = results
        .map((r) => (r.status === 'fulfilled' ? r.value : null))
        .filter((m): m is UploadMetrics => m !== null);

    const successful = metrics.filter((m) => m.success);
    const failed = metrics.filter((m) => !m.success);

    console.log(`${'='.repeat(60)}`);
    console.log('📊 UPLOAD LOAD TEST RESULTS');
    console.log(`${'='.repeat(60)}\n`);

    console.log(`Total Uploads:     ${CONCURRENT_UPLOADS}`);
    console.log(`Successful:        ${successful.length} (${((successful.length / CONCURRENT_UPLOADS) * 100).toFixed(1)}%)`);
    console.log(`Failed:            ${failed.length}`);
    console.log(`Total Duration:    ${(totalDuration / 1000).toFixed(2)}s`);
    console.log(`Total Data:        ${(CONCURRENT_UPLOADS * FILE_SIZE_MB / 1024).toFixed(2)}GB`);

    if (successful.length > 0) {
        const avgDuration = successful.reduce((sum, m) => sum + (m.duration || 0), 0) / successful.length;
        const minDuration = Math.min(...successful.map((m) => m.duration || 0));
        const maxDuration = Math.max(...successful.map((m) => m.duration || 0));

        console.log(`\nUpload Duration (avg): ${(avgDuration / 1000).toFixed(2)}s`);
        console.log(`Upload Duration (min): ${(minDuration / 1000).toFixed(2)}s`);
        console.log(`Upload Duration (max): ${(maxDuration / 1000).toFixed(2)}s`);

        const throughputMBps = (CONCURRENT_UPLOADS * FILE_SIZE_MB * 1000) / totalDuration;
        console.log(`\nThroughput:        ${throughputMBps.toFixed(2)} MB/s`);
    }

    if (failed.length > 0) {
        console.log(`\n❌ Failed Uploads:`);
        failed.forEach((m) => {
            console.log(`   ${m.filename}: ${m.error}`);
        });
    }

    // Performance Thresholds
    console.log(`\n${'='.repeat(60)}`);
    console.log('🎯 PERFORMANCE THRESHOLDS');
    console.log(`${'='.repeat(60)}\n`);

    const successRate = (successful.length / CONCURRENT_UPLOADS) * 100;
    const avgDuration = successful.length > 0
        ? successful.reduce((sum, m) => sum + (m.duration || 0), 0) / successful.length
        : 0;

    const thresholds = {
        'Success Rate': {
            actual: successRate,
            target: 95,
            unit: '%',
            pass: successRate >= 95,
        },
        'Avg Upload Time': {
            actual: avgDuration / 1000,
            target: 120,
            unit: 's',
            pass: avgDuration / 1000 <= 120,
        },
        'Concurrent Handling': {
            actual: successful.length,
            target: CONCURRENT_UPLOADS * 0.9,
            unit: 'uploads',
            pass: successful.length >= CONCURRENT_UPLOADS * 0.9,
        },
    };

    Object.entries(thresholds).forEach(([name, threshold]) => {
        const status = threshold.pass ? '✅' : '❌';
        console.log(`${status} ${name}: ${threshold.actual.toFixed(2)}${threshold.unit} (target: ${threshold.target}${threshold.unit})`);
    });

    const allPassed = Object.values(thresholds).every((t) => t.pass);

    console.log(`\n${'='.repeat(60)}`);
    if (allPassed) {
        console.log('✅ ALL THRESHOLDS MET - Upload system is robust!');
    } else {
        console.log('❌ SOME THRESHOLDS NOT MET - Review and optimize');
    }
    console.log(`${'='.repeat(60)}\n`);

    console.log(`Completed: ${new Date().toISOString()}`);

    process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
    console.error('Upload load test failed:', err);
    process.exit(1);
});
