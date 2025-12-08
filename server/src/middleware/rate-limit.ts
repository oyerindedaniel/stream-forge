import { FastifyRequest, FastifyReply } from "fastify";
import { RateLimiter, RateLimitResult } from "../lib/rate-limiter";

export function createRateLimitMiddleware(
    rateLimiter: RateLimiter,
    endpoint: string
) {
    return async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = request.ip || "unknown";

        try {
            const result: RateLimitResult = await rateLimiter.checkLimit(
                userId,
                endpoint
            );

            const config = rateLimiter.getConfig();
            const windowSeconds = Math.floor(config.windowMs / 1000);

            reply.header("X-RateLimit-Limit", result.total.toString());
            reply.header("X-RateLimit-Remaining", result.remaining.toString());
            reply.header("X-RateLimit-Reset", result.resetAt.toISOString());
            reply.header("X-RateLimit-Policy", `${result.total};w=${windowSeconds}`);

            if (!result.allowed) {
                const retryAfter = Math.ceil(
                    (result.resetAt.getTime() - Date.now()) / 1000
                );

                reply.header("Retry-After", retryAfter.toString());

                return reply.status(429).send({
                    error: "Too Many Requests",
                    message: `Rate limit exceeded. You have made ${result.current} requests. Maximum allowed is ${result.total} per window.`,
                    retryAfter,
                    resetAt: result.resetAt.toISOString(),
                    limit: {
                        total: result.total,
                        remaining: result.remaining,
                        current: result.current,
                    },
                });
            }
        } catch (error) {
            console.error("[RateLimit] Error checking rate limit:", error);

            return reply.status(500).send({
                error: "Internal Server Error",
                message: "Failed to check rate limit",
            });
        }
    };
}