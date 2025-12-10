import { storage } from "../lib/storage";

export async function cleanupAbandonedMultipartUploads() {
  const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

  try {
    const response = await storage.getMultipartUploads();

    if (!response.Uploads || response.Uploads.length === 0) {
      console.log("[Cron] No multipart uploads to clean up");
      return { aborted: 0 };
    }

    let abortedCount = 0;

    for (const upload of response.Uploads) {
      if (
        upload &&
        upload.Key &&
        upload.UploadId &&
        upload.Initiated &&
        upload.Initiated < cutoffTime
      ) {
        console.log(
          `[Cron] Aborting abandoned upload: ${upload.Key}, UploadId: ${upload.UploadId}`
        );

        await storage.abortMultipartUpload(upload.Key, upload.UploadId);
        abortedCount++;
      }
    }

    console.log(
      `[Cron] Cleanup complete: Aborted ${abortedCount} multipart uploads`
    );
    return { aborted: abortedCount };
  } catch (error) {
    console.error("[Cron] Error cleaning up multipart uploads:", error);
    throw error;
  }
}
