import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

const defaultOptions = {
    retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
    },
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    enableOfflineQueue: true,
    lazyConnect: false,
};

export const redisConnection = new Redis(redisUrl, defaultOptions);

export const redis = new Redis(redisUrl, {
    ...defaultOptions,
    maxRetriesPerRequest: 20,
});

redisConnection.on('error', (err) => {
    console.error('Redis connection error:', err);
});

redisConnection.on('connect', () => {
    console.log('Redis connected');
});

redis.on('error', (err) => {
    console.error('Redis client error:', err);
});

export async function closeRedis() {
    await Promise.all([
        redisConnection.quit(),
        redis.quit(),
    ]);
}

process.on('SIGTERM', closeRedis);
process.on('SIGINT', closeRedis);
