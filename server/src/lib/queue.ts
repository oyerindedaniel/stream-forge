import "dotenv/config";

import { Queue } from "bullmq";
import { redisPrimary } from "./redis";
import { NODE_ENV } from "./constants";

export const VIDEO_PROCESSING_QUEUE = "video-processing";

export const videoQueue = new Queue(VIDEO_PROCESSING_QUEUE, {
  connection: redisPrimary,
  defaultJobOptions: {
    attempts: NODE_ENV === "development" ? 1 : 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      count: 100,
      age: 24 * 3600,
    },
    removeOnFail: {
      count: 1000,
      age: 7 * 24 * 3600,
    },
  },
});

process.on("SIGTERM", async () => {
  await videoQueue.close();
});
