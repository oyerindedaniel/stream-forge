import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import dotenv from "dotenv";
import path from "path";
import fastifyStatic from "@fastify/static";
import { Server } from "socket.io";
import { startScheduledJobs } from "./jobs/scheduler";

dotenv.config();

const fastify = Fastify({
  logger: true,
});

fastify.register(cors, {
  origin: process.env.CORS_ORIGIN || "*",
  credentials: true,
});

fastify.register(fastifyStatic, {
  root: path.join(process.cwd(), "tmp"),
  prefix: "/files/",
});

import { uploadRoutes } from "./modules/upload/routes";
import { videoRoutes } from "./modules/videos/routes";
import { healthRoutes } from "./modules/health/routes";
import { createRateLimitMiddleware } from "./middleware/rate-limit";
import { uploadRateLimiter, apiRateLimiter } from "./lib/rate-limiter";
import { redisPrimary } from "./lib/redis";

fastify.register(healthRoutes);
fastify.register(uploadRoutes, {
  prefix: "/api/v1/uploads",
  preHandler: createRateLimitMiddleware(uploadRateLimiter, "uploads"),
});
fastify.register(videoRoutes, {
  prefix: "/api/v1/videos",
  preHandler: createRateLimitMiddleware(apiRateLimiter, "videos"),
});

startScheduledJobs();

fastify.get("/", async (request, reply) => {
  return { hello: "world", server: "stream-forge-backend", version: "1.0.0" };
});

const start = async () => {
  try {
    const port = parseInt(process.env.PORT || "3001");
    const host = "0.0.0.0";

    await fastify.listen({ port, host });
    console.log(`[Server] HTTP listening on http://${host}:${port}`);

    // Setup Socket.IO
    const io = new Server(fastify.server, {
      cors: {
        origin: process.env.CORS_ORIGIN || "*",
        credentials: true,
      },
    });

    io.on("connection", (socket) => {
      console.log(`[Socket.IO] Client connected: ${socket.id}`);

      socket.on("subscribe:video", (videoId: string) => {
        socket.join(`video:${videoId}`);
        console.log(`[Socket.IO] ${socket.id} subscribed to video:${videoId}`);
      });

      socket.on("unsubscribe:video", (videoId: string) => {
        socket.leave(`video:${videoId}`);
        console.log(
          `[Socket.IO] ${socket.id} unsubscribed from video:${videoId}`
        );
      });

      socket.on("subscribe:upload", (uploadId: string) => {
        socket.join(`upload:${uploadId}`);
        console.log(
          `[Socket.IO] ${socket.id} subscribed to upload:${uploadId}`
        );
      });

      socket.on("unsubscribe:upload", (uploadId: string) => {
        socket.leave(`upload:${uploadId}`);
        console.log(
          `[Socket.IO] ${socket.id} unsubscribed from upload:${uploadId}`
        );
      });

      socket.on("disconnect", () => {
        console.log(`[Socket.IO] Client disconnected: ${socket.id}`);
      });
    });

    (fastify as typeof fastify & { io: Server }).io = io;

    const subscriber = redisPrimary.duplicate();
    await subscriber.subscribe("video:status");

    subscriber.on("message", (channel, message) => {
      if (channel === "video:status") {
        try {
          const event = JSON.parse(message) as {
            videoId: string;
            status: string;
            error?: string;
          };
          console.log(`[Redis] Video status update:`, event);

          io.to(`video:${event.videoId}`).emit("video:status", event);
        } catch (e) {
          console.error("[Redis] Failed to parse message:", e);
        }
      }
    });

    console.log("[Server] Socket.IO initialized");
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();

export { fastify };
