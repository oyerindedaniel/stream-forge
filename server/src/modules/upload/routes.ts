import { FastifyInstance } from "fastify";
import { db } from "../../db";
import { videos } from "../../db/schema";
import { storage } from "../../lib/storage";
import { videoQueue } from "../../lib/queue";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import {
  UploadPartCommand,
  CompleteMultipartUploadCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { S3Keys } from "../../lib/s3-keys";
import {
  MULTIPART_THRESHOLD,
  PRESIGNED_URL_EXPIRATION,
  MULTIPART_CHUNK_SIZE,
  MAX_FILE_SIZE,
  MAX_MULTIPART_PARTS,
} from "../../lib/constants";
import { validateS3FileChecksum } from "../../lib/checksum";

export async function uploadRoutes(fastify: FastifyInstance) {
  fastify.post("/", async (request, reply) => {
    const { filename, contentType, size, metadata, checksum } =
      request.body as {
        filename: string;
        contentType: string;
        size: number;
        metadata?: Record<string, unknown>;
        checksum?: string;
      };

    if (size > MAX_FILE_SIZE) {
      return reply.status(413).send({
        error: "File too large",
        maxSize: MAX_FILE_SIZE,
        receivedSize: size,
      });
    }

    if (size <= 0) {
      return reply.status(400).send({ error: "Invalid file size" });
    }

    const videoId = randomUUID();
    const key = S3Keys.source(videoId, filename);

    const useMultipart = size > MULTIPART_THRESHOLD;

    if (useMultipart) {
      // For multipart, we store the checksum but don't enforce it via S3 headers yet
      // as it requires per-part checksum logic
      const multipartUpload = await storage.createMultipartUpload(
        key,
        contentType
      );

      const partSize = MULTIPART_CHUNK_SIZE;
      const numParts = Math.ceil(size / partSize);

      if (numParts > MAX_MULTIPART_PARTS) {
        return reply.status(400).send({
          error: "File requires too many parts",
          maxParts: MAX_MULTIPART_PARTS,
          requiredParts: numParts,
        });
      }

      const partUrls: string[] = [];
      for (let partNumber = 1; partNumber <= numParts; partNumber++) {
        const uploadPartCommand = new UploadPartCommand({
          Bucket: storage.bucketName,
          Key: key,
          PartNumber: partNumber,
          UploadId: multipartUpload.UploadId!,
        });

        const signedUrl = await getSignedUrl(
          storage.s3Client,
          uploadPartCommand,
          { expiresIn: PRESIGNED_URL_EXPIRATION }
        );
        partUrls.push(signedUrl);
      }

      await db.insert(videos).values({
        id: videoId,
        title: (metadata?.title as string | undefined) || filename,
        status: "pending_upload",
        sourceUrl: `s3://${storage.bucketName}/${key}`,
        sourceSize: size,
        sourceChecksum: checksum,
      });

      return {
        type: "multipart",
        uploadId: videoId,
        multipartUploadId: multipartUpload.UploadId,
        partUrls,
        partSize,
        numParts,
        expiresAt: new Date(
          Date.now() + PRESIGNED_URL_EXPIRATION * 1000
        ).toISOString(),
      };
    } else {
      const uploadUrl = await storage.getUploadUrl(
        key,
        contentType,
        checksum,
        PRESIGNED_URL_EXPIRATION
      );

      await db.insert(videos).values({
        id: videoId,
        title: (metadata?.title as string | undefined) || filename,
        status: "pending_upload",
        sourceUrl: `s3://${storage.bucketName}/${key}`,
        sourceSize: size,
        sourceChecksum: checksum,
      });

      return {
        type: "single",
        uploadId: videoId,
        uploadUrl,
        expiresAt: new Date(
          Date.now() + PRESIGNED_URL_EXPIRATION * 1000
        ).toISOString(),
      };
    }
  });

  fastify.post("/:uploadId/refresh-urls", async (request, reply) => {
    const { uploadId } = request.params as { uploadId: string };
    const { multipartUploadId } = request.body as {
      multipartUploadId: string;
    };

    const video = await db
      .select()
      .from(videos)
      .where(eq(videos.id, uploadId))
      .limit(1);

    if (!video || video.length === 0) {
      return reply.status(404).send({ error: "Video not found" });
    }

    const videoData = video[0];

    if (videoData.status !== "pending_upload") {
      return reply.status(400).send({
        error: "Upload not in progress",
        currentStatus: videoData.status,
      });
    }

    const s3Key = S3Keys.parseS3Url(videoData.sourceUrl, storage.bucketName);
    const partSize = MULTIPART_CHUNK_SIZE;
    const numParts = Math.ceil(videoData.sourceSize / partSize);

    const partUrls: string[] = [];
    for (let partNumber = 1; partNumber <= numParts; partNumber++) {
      const uploadPartCommand = new UploadPartCommand({
        Bucket: storage.bucketName,
        Key: s3Key,
        PartNumber: partNumber,
        UploadId: multipartUploadId,
      });

      const signedUrl = await getSignedUrl(
        storage.s3Client,
        uploadPartCommand,
        { expiresIn: PRESIGNED_URL_EXPIRATION }
      );
      partUrls.push(signedUrl);
    }

    return {
      partUrls,
      partSize,
      expiresAt: new Date(
        Date.now() + PRESIGNED_URL_EXPIRATION * 1000
      ).toISOString(),
    };
  });

  fastify.post("/:uploadId/complete", async (request, reply) => {
    const { uploadId } = request.params as { uploadId: string };
    const { multipartUploadId, parts } = request.body as {
      multipartUploadId?: string;
      parts?: Array<{ PartNumber: number; ETag: string }>;
    };

    const video = await db
      .select()
      .from(videos)
      .where(eq(videos.id, uploadId))
      .limit(1);

    if (!video || video.length === 0) {
      return reply.status(404).send({ error: "Video not found" });
    }

    const videoData = video[0];

    if (videoData.status !== "pending_upload") {
      return reply.status(400).send({
        error: "Invalid upload state",
        currentStatus: videoData.status,
      });
    }

    const s3Key = S3Keys.parseS3Url(videoData.sourceUrl, storage.bucketName);

    if (multipartUploadId && parts) {
      if (!Array.isArray(parts) || parts.length === 0) {
        return reply.status(400).send({ error: "Invalid parts array" });
      }

      const sortedParts = [...parts].sort(
        (a, b) => a.PartNumber - b.PartNumber
      );

      for (let i = 0; i < sortedParts.length; i++) {
        if (sortedParts[i].PartNumber !== i + 1) {
          return reply.status(400).send({
            error: "Parts must be sequential starting from 1",
          });
        }
        if (!sortedParts[i].ETag) {
          return reply.status(400).send({
            error: `Missing ETag for part ${sortedParts[i].PartNumber}`,
          });
        }
      }

      try {
        const completeCommand = new CompleteMultipartUploadCommand({
          Bucket: storage.bucketName,
          Key: s3Key,
          UploadId: multipartUploadId,
          MultipartUpload: { Parts: sortedParts },
        });

        await storage.s3Client.send(completeCommand);
      } catch (error) {
        await db
          .update(videos)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(videos.id, uploadId));
        throw error;
      }
    }

    if (videoData.sourceChecksum) {
      try {
        const validation = await validateS3FileChecksum(
          storage.bucketName,
          s3Key,
          videoData.sourceChecksum
        );

        if (!validation.valid) {
          await db
            .update(videos)
            .set({ status: "failed", updatedAt: new Date() })
            .where(eq(videos.id, uploadId));

          return reply.status(400).send({
            error: "Checksum validation failed",
            message: "File corrupted during upload",
            expected: videoData.sourceChecksum,
            received: validation.actualChecksum,
          });
        }

        console.log(`[Checksum] Validated for video ${uploadId}`);
      } catch (error) {
        console.error("[Checksum] Validation error:", error);
        await db
          .update(videos)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(videos.id, uploadId));

        return reply.status(500).send({
          error: "Checksum validation failed",
          message: "Could not verify file integrity",
        });
      }
    }

    await db
      .update(videos)
      .set({ status: "processing", updatedAt: new Date() })
      .where(eq(videos.id, uploadId));

    await videoQueue.add("transcode", {
      videoId: videoData.id,
      sourceUrl: videoData.sourceUrl,
    });

    return {
      videoId: videoData.id,
      status: "processing",
    };
  });

  fastify.post("/:uploadId/abort", async (request, reply) => {
    const { uploadId } = request.params as { uploadId: string };
    const { multipartUploadId } = request.body as {
      multipartUploadId?: string;
    };

    const video = await db
      .select()
      .from(videos)
      .where(eq(videos.id, uploadId))
      .limit(1);

    if (!video || video.length === 0) {
      return reply.status(404).send({ error: "Video not found" });
    }

    const s3Key = S3Keys.parseS3Url(video[0].sourceUrl, storage.bucketName);

    if (multipartUploadId) {
      try {
        await storage.abortMultipartUpload(s3Key, multipartUploadId);
      } catch (error) {
        console.error("S3 abort failed:", error);
      }
    }

    await db
      .update(videos)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(videos.id, uploadId));

    return { success: true };
  });
}
