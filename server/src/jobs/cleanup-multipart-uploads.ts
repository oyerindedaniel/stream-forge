import { storage } from "../lib/storage";
import {
  ListMultipartUploadsCommand,
  AbortMultipartUploadCommand,
} from "@aws-sdk/client-s3";

export async function cleanupAbandonedMultipartUploads() {
  const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

  try {
    const listCommand = new ListMultipartUploadsCommand({
      Bucket: storage.bucketName,
    });

    const response = await storage.s3Client.send(listCommand);

    if (!response.Uploads || response.Uploads.length === 0) {
      console.log("No multipart uploads to clean up");
      return { aborted: 0 };
    }

    let abortedCount = 0;

    for (const upload of response.Uploads) {
      if (upload.Initiated && upload.Initiated < cutoffTime) {
        console.log(
          `Aborting abandoned upload: ${upload.Key}, UploadId: ${upload.UploadId}`
        );

        const abortCommand = new AbortMultipartUploadCommand({
          Bucket: storage.bucketName,
          Key: upload.Key!,
          UploadId: upload.UploadId!,
        });

        await storage.s3Client.send(abortCommand);
        abortedCount++;
      }
    }

    console.log(`Cleanup complete: Aborted ${abortedCount} multipart uploads`);
    return { aborted: abortedCount };
  } catch (error) {
    console.error("Error cleaning up multipart uploads:", error);
    throw error;
  }
}
