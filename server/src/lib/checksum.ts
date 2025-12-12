import crypto from "crypto";
import { storage } from "./storage";

export async function validateS3PartChecksums(
  bucket: string,
  key: string,
  expectedParts: Array<{
    partNumber: number;
    checksum: string;
    size: number;
  }>,
  partSize: number
): Promise<{
  valid: boolean;
  failures: Array<{ partNumber: number; error: string }>;
}> {
  const CONCURRENCY = 5;
  const failures: Array<{ partNumber: number; error: string }> = [];

  console.log(
    `[Validation] Starting parallel validation of ${expectedParts.length} parts with concurrency ${CONCURRENCY}`
  );

  for (let i = 0; i < expectedParts.length; i += CONCURRENCY) {
    const batch = expectedParts.slice(i, i + CONCURRENCY);
    const batchNum = Math.floor(i / CONCURRENCY) + 1;
    const totalBatches = Math.ceil(expectedParts.length / CONCURRENCY);

    console.log(
      `[Validation] Processing batch ${batchNum}/${totalBatches} (parts ${
        i + 1
      }-${Math.min(i + CONCURRENCY, expectedParts.length)})`
    );

    const results = await Promise.allSettled(
      batch.map(async (part) => {
        try {
          const startByte = (part.partNumber - 1) * partSize;
          const endByte = startByte + part.size - 1;

          const partData = await storage.downloadPartialFile(
            key,
            startByte,
            endByte
          );

          const hash = crypto.createHash("sha256");
          hash.update(partData);
          const actualChecksum = hash.digest("base64");

          if (actualChecksum !== part.checksum) {
            console.error(
              `[Validation] Part ${part.partNumber} checksum mismatch!`
            );
            return {
              success: false,
              partNumber: part.partNumber,
              error: `Checksum mismatch. Expected: ${part.checksum.substring(
                0,
                10
              )}..., Got: ${actualChecksum.substring(0, 10)}...`,
            };
          }

          console.log(
            `[Validation] Part ${part.partNumber}/${expectedParts.length} ✓`
          );
          return { success: true, partNumber: part.partNumber };
        } catch (error) {
          console.error(
            `[Validation] Part ${part.partNumber} validation failed:`,
            error
          );
          return {
            success: false,
            partNumber: part.partNumber,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      })
    );

    results.forEach((result) => {
      if (result.status === "fulfilled" && !result.value.success) {
        failures.push({
          partNumber: result.value.partNumber,
          error: result.value.error || "An unknown error occurred",
        });
      } else if (result.status === "rejected") {
        console.error(`[Validation] Batch promise rejected:`, result.reason);
        failures.push({
          partNumber: 0,
          error: result.reason,
        });
      }
    });

    console.log(
      `[Validation] Batch ${batchNum}/${totalBatches} completed (${
        results.filter(
          (result) => result.status === "fulfilled" && result.value.success
        ).length
      }/${batch.length} valid)`
    );
  }

  const isValid = failures.length === 0;
  console.log(
    `[Validation] Completed - ${
      isValid ? "ALL VALID ✓" : `${failures.length} FAILURES ✗`
    }`
  );

  return {
    valid: isValid,
    failures,
  };
}
