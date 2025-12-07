import autocannon, { Result } from 'autocannon';

const API_URL = process.env.API_URL || 'http://localhost:3001';

interface LoadTestConfig {
    url: string;
    connections: number;
    duration: number;
    pipelining: number;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    body?: string;
    headers?: Record<string, string>;
}

async function runLoadTest(name: string, config: LoadTestConfig): Promise<Result> {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Running: ${name}`);
    console.log(`${'='.repeat(60)}\n`);

    return new Promise((resolve, reject) => {
        const instance = autocannon({
            url: config.url,
            connections: config.connections,
            duration: config.duration,
            pipelining: config.pipelining,
            method: config.method || 'GET',
            body: config.body,
            headers: config.headers,
        }, (err, result) => {
            if (err) {
                reject(err);
            } else {
                console.log(`\n📊 Results for ${name}:`);
                console.log(`   Requests:  ${result.requests.total} total, ${result.requests.average} req/sec`);
                console.log(`   Latency:   ${result.latency.mean}ms (mean), ${result.latency.p99}ms (p99)`);
                console.log(`   Throughput: ${(result.throughput.total / 1024 / 1024).toFixed(2)} MB`);
                console.log(`   Errors:    ${result.errors}`);
                console.log(`   Timeouts:  ${result.timeouts}`);
                resolve(result);
            }
        });

        autocannon.track(instance);
    });
}

async function main() {
    console.log('🚀 StreamForge Load Testing Suite\n');
    console.log(`Target: ${API_URL}`);
    console.log(`Started: ${new Date().toISOString()}\n`);

    const results: Record<string, Result> = {};

    // Test 1: Health Check Baseline
    results.health = await runLoadTest('Health Check Baseline', {
        url: `${API_URL}/health`,
        connections: 10,
        duration: 10,
        pipelining: 1,
    });

    // Test 2: Video List API (Light Load)
    results.videoListLight = await runLoadTest('Video List API - Light Load', {
        url: `${API_URL}/api/v1/videos`,
        connections: 50,
        duration: 30,
        pipelining: 1,
    });

    // Test 3: Video List API (Heavy Load)
    results.videoListHeavy = await runLoadTest('Video List API - Heavy Load', {
        url: `${API_URL}/api/v1/videos`,
        connections: 200,
        duration: 30,
        pipelining: 10,
    });

    // Test 4: Single Video Details
    results.videoDetails = await runLoadTest('Single Video Details', {
        url: `${API_URL}/api/v1/videos/test-video-id`,
        connections: 100,
        duration: 20,
        pipelining: 1,
    });

    // Test 5: Upload Initialization (Simulated)
    results.uploadInit = await runLoadTest('Upload Initialization', {
        url: `${API_URL}/api/v1/uploads`,
        connections: 50,
        duration: 20,
        pipelining: 1,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            filename: 'test-video.mp4',
            contentType: 'video/mp4',
            size: 100 * 1024 * 1024, // 100MB
            metadata: { title: 'Load Test Video' },
        }),
    });

    // Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log('📈 LOAD TEST SUMMARY');
    console.log(`${'='.repeat(60)}\n`);

    Object.entries(results).forEach(([name, result]) => {
        const passedLatency = result.latency.p99 < 1000; // p99 < 1s
        const passedErrors = result.errors === 0;
        const status = passedLatency && passedErrors ? '✅ PASS' : '❌ FAIL';

        console.log(`${status} ${name}`);
        console.log(`   ${result.requests.average} req/sec | ${result.latency.p99}ms p99 | ${result.errors} errors`);
    });

    // Performance Thresholds
    console.log(`\n${'='.repeat(60)}`);
    console.log('🎯 PERFORMANCE THRESHOLDS');
    console.log(`${'='.repeat(60)}\n`);

    const thresholds = {
        'Requests/sec (Video List)': {
            actual: results.videoListLight.requests.average,
            target: 100,
            pass: results.videoListLight.requests.average >= 100,
        },
        'P99 Latency (Video List)': {
            actual: results.videoListLight.latency.p99,
            target: 500,
            pass: results.videoListLight.latency.p99 <= 500,
        },
        'Error Rate': {
            actual: results.videoListHeavy.errors,
            target: 0,
            pass: results.videoListHeavy.errors === 0,
        },
        'Upload Init Throughput': {
            actual: results.uploadInit.requests.average,
            target: 50,
            pass: results.uploadInit.requests.average >= 50,
        },
    };

    Object.entries(thresholds).forEach(([name, threshold]) => {
        const status = threshold.pass ? '✅' : '❌';
        console.log(`${status} ${name}: ${threshold.actual} (target: ${threshold.target})`);
    });

    const allPassed = Object.values(thresholds).every((t) => t.pass);

    console.log(`\n${'='.repeat(60)}`);
    if (allPassed) {
        console.log('✅ ALL TESTS PASSED - System is performing well!');
    } else {
        console.log('❌ SOME TESTS FAILED - Review and optimize');
    }
    console.log(`${'='.repeat(60)}\n`);

    console.log(`Completed: ${new Date().toISOString()}`);

    process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
    console.error('Load test failed:', err);
    process.exit(1);
});
