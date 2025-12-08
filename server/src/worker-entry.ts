import dotenv from "dotenv";
import { worker } from "./workers";
import { Job } from "bullmq";
import { redisPublisher } from "./lib/redis";
import { REDIS_URL, S3_BUCKET_NAME } from "./lib/constants";

dotenv.config();

console.log("[Worker] Starting video processing worker...");
console.log("[Worker] Redis URL:", REDIS_URL);
console.log("[Worker] S3 Bucket:", S3_BUCKET_NAME);

worker.on("ready", () => {
  console.log("[Worker] Worker is ready and waiting for jobs");
});

worker.on("active", (job: Job) => {
  console.log(
    `[Worker] Processing job ${job.id} for video ${job.data.videoId}`
  );

  redisPublisher
    .publish(
      "video:status",
      JSON.stringify({
        videoId: job.data.videoId,
        status: "processing",
      })
    )
    .catch((err) => console.error("[Worker] Failed to publish status:", err));
});

worker.on("completed", (job: Job) => {
  console.log(`[Worker] Job ${job.id} completed successfully`);

  redisPublisher
    .publish(
      "video:status",
      JSON.stringify({
        videoId: job.data.videoId,
        status: "ready",
      })
    )
    .catch((err) => console.error("[Worker] Failed to publish status:", err));
});

worker.on("failed", (job: Job | undefined, err: Error) => {
  console.error(`[Worker] Job ${job?.id} failed:`, err.message);
  console.error("[Worker] Error stack:", err.stack);

  if (job) {
    redisPublisher
      .publish(
        "video:status",
        JSON.stringify({
          videoId: job.data.videoId,
          status: "failed",
          error: err.message,
        })
      )
      .catch((err) => console.error("[Worker] Failed to publish status:", err));
  }
});

worker.on("error", (err: Error) => {
  console.error("[Worker] Worker error:", err);
});

worker.on("stalled", (jobId: string) => {
  console.warn(`[Worker] Job ${jobId} stalled`);
});

async function gracefulShutdown() {
  console.log("[Worker] Shutting down gracefully...");
  await worker.close();
  process.exit(0);
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

process.on("uncaughtException", (err) => {
  console.error("[Worker] Uncaught exception:", err);
  gracefulShutdown();
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("[Worker] Unhandled rejection at:", promise, "reason:", reason);
});
