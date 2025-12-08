import cron from "node-cron";
import { cleanupAbandonedMultipartUploads } from "./cleanup-multipart-uploads";

export function startScheduledJobs() {
  // Run cleanup every 6 hours
  cron.schedule("0 */6 * * *", async () => {
    console.log("Starting multipart upload cleanup job...");
    try {
      await cleanupAbandonedMultipartUploads();
    } catch (error) {
      console.error("Cleanup job failed:", error);
    }
  });

  console.log("Scheduled jobs started");
}
