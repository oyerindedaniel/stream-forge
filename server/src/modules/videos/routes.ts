import { FastifyInstance } from "fastify";
import { db } from "../../db";
import { videos } from "../../db/schema";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { storage } from "../../lib/storage";
import { S3Keys } from "../../lib/s3-keys";

export async function videoRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request, reply) => {
    const allVideos = await db
      .select()
      .from(videos)
      .where(and(ne(videos.status, "deleted"), isNull(videos.deletedAt)))
      .orderBy(desc(videos.createdAt));

    return {
      videos: allVideos.map((video) => ({
        id: video.id,
        title: video.title,
        status: video.status,
        duration: video.duration,
        width: video.width,
        height: video.height,
        createdAt: video.createdAt,
      })),
    };
  });

  fastify.get("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = await db
      .select()
      .from(videos)
      .limit(1)
      .where(eq(videos.id, id));

    if (!result || result.length === 0) {
      return reply.status(404).send({ error: "Video not found" });
    }

    const video = result[0];

    if (video.status === "ready" && video.manifestUrl) {
      try {
        const manifest = await storage.getFileAsJson(video.manifestUrl);
        return { ...video, manifest };
      } catch (error) {
        console.error("Failed to fetch manifest:", error);
      }
    }

    return video;
  });

  fastify.get("/:id/status", async (request, reply) => {
    const { id } = request.params as { id: string };

    const video = await db
      .select()
      .from(videos)
      .where(eq(videos.id, id))
      .limit(1);

    if (!video || video.length === 0) {
      return reply.status(404).send({ error: "Video not found" });
    }

    return {
      videoId: video[0].id,
      status: video[0].status,
      title: video[0].title,
    };
  });

  fastify.delete("/:id", async (request, reply) => {
    const { id } = request.params as { id: string };

    const video = await db
      .select()
      .from(videos)
      .where(eq(videos.id, id))
      .limit(1);

    if (!video || video.length === 0) {
      return reply.status(404).send({ error: "Video not found" });
    }

    if (video[0].sourceUrl) {
      const s3Key = S3Keys.parseS3Url(video[0].sourceUrl, storage.bucketName);

      if (await storage.fileExists(s3Key)) {
        await storage.deleteFile(s3Key);
      }
    }

    await db
      .update(videos)
      .set({
        status: "deleted",
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(videos.id, id));

    return { success: true };
  });
}
