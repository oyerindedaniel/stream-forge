import Redis from "ioredis";
import dotenv from "dotenv";
import { REDIS_URL } from "./constants";

dotenv.config();

const redisUrl = REDIS_URL;

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

export const redisPrimary = new Redis(redisUrl, defaultOptions);

export const redisPublisher = new Redis(redisUrl, {
  ...defaultOptions,
  maxRetriesPerRequest: 20,
});

redisPrimary.on("error", (err) => {
  console.error("Redis connection error:", err);
});

redisPrimary.on("connect", () => {
  console.log("Redis connected");
});

redisPublisher.on("error", (err) => {
  console.error("Redis client error:", err);
});

export async function closeRedis() {
  await Promise.all([redisPrimary.quit(), redisPublisher.quit()]);
}

process.on("SIGTERM", closeRedis);
process.on("SIGINT", closeRedis);
