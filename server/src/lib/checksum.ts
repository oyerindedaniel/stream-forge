import crypto from "crypto";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { storage } from "./storage";

export async function validateS3FileChecksum(
  bucket: string,
  key: string,
  expectedChecksum: string
): Promise<{ valid: boolean; actualChecksum: string }> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  const response = await storage.s3Client.send(command);

  if (!response.Body) {
    throw new Error("No file body returned from S3");
  }

  const hash = crypto.createHash("sha256");
  const stream = response.Body as NodeJS.ReadableStream;

  return new Promise((resolve, reject) => {
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => {
      const actualChecksum = hash.digest("base64");
      resolve({
        valid: actualChecksum === expectedChecksum,
        actualChecksum,
      });
    });
    stream.on("error", reject);
  });
}
