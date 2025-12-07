import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getHealthStatus } from '../lib/monitoring';
import { db } from '../db';
import { redis } from '../lib/redis';
import { storage } from '../lib/storage';
import { sql } from 'drizzle-orm';

export async function healthRoutes(fastify: FastifyInstance) {
    // Basic health check
    fastify.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
        return { status: 'ok', timestamp: new Date().toISOString() };
    });

    // Detailed health check
    fastify.get('/health/detailed', async (request: FastifyRequest, reply: FastifyReply) => {
        const health = await getHealthStatus({
            database: async () => {
                try {
                    await db.execute(sql`SELECT 1`);
                    return true;
                } catch {
                    return false;
                }
            },
            redis: async () => {
                try {
                    await redis.ping();
                    return true;
                } catch {
                    return false;
                }
            },
            storage: async () => {
                try {
                    return storage.bucketIsConfigured;
                } catch {
                    return false;
                }
            },
        });

        const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;

        return reply.code(statusCode).send(health);
    });

    // Readiness probe (for Kubernetes)
    fastify.get('/ready', async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            await db.execute(sql`SELECT 1`);
            await redis.ping();
            return { ready: true };
        } catch {
            return reply.code(503).send({ ready: false });
        }
    });

    // Liveness probe (for Kubernetes)
    fastify.get('/live', async (request: FastifyRequest, reply: FastifyReply) => {
        return { alive: true };
    });

    // Metrics endpoint (Prometheus compatible)
    fastify.get('/metrics', async (request: FastifyRequest, reply: FastifyReply) => {
        const memUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();

        // Simple Prometheus format
        const metrics = [
            `# HELP process_memory_bytes Process memory usage in bytes`,
            `# TYPE process_memory_bytes gauge`,
            `process_memory_rss_bytes ${memUsage.rss}`,
            `process_memory_heap_total_bytes ${memUsage.heapTotal}`,
            `process_memory_heap_used_bytes ${memUsage.heapUsed}`,
            `process_memory_external_bytes ${memUsage.external}`,
            ``,
            `# HELP process_cpu_usage_seconds Process CPU usage in seconds`,
            `# TYPE process_cpu_usage_seconds counter`,
            `process_cpu_user_seconds ${cpuUsage.user / 1000000}`,
            `process_cpu_system_seconds ${cpuUsage.system / 1000000}`,
            ``,
            `# HELP process_uptime_seconds Process uptime in seconds`,
            `# TYPE process_uptime_seconds gauge`,
            `process_uptime_seconds ${process.uptime()}`,
        ].join('\n');

        return reply.type('text/plain').send(metrics);
    });
}
