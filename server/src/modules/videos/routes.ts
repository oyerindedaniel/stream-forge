import { FastifyInstance } from 'fastify';
import { db } from '../../db';
import { videos } from '../../db/schema';
import { desc, eq } from 'drizzle-orm';

export async function videoRoutes(fastify: FastifyInstance) {
    fastify.get('/', async (request, reply) => {
        const allVideos = await db.select().from(videos).orderBy(desc(videos.createdAt));
        return { videos: allVideos };
    });

    fastify.get('/:id', async (request, reply) => {
        const { id } = request.params as { id: string };
        const result = await db.select().from(videos).limit(1).where(eq(videos.id, id));

        if (!result || result.length === 0) {
            return reply.status(404).send({ error: 'Video not found' });
        }

        return result[0];
    });
}
