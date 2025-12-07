import { pgTable, text, timestamp, integer, real, jsonb, primaryKey, boolean } from 'drizzle-orm/pg-core';

export const videos = pgTable('videos', {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    status: text('status').notNull().default('pending_upload'),

    sourceUrl: text('source_url'),
    sourceSize: integer('source_size'),

    manifestUrl: text('manifest_url'),
    initSegmentUrl: text('init_segment_url'),
    keyframeIndexUrl: text('keyframe_index_url'),

    thumbnails: jsonb('thumbnails').$type<{
        pattern?: string;
        interval?: number;
        sprite?: string;
    }>(),

    duration: real('duration'),
    width: integer('width'),
    height: integer('height'),
    codec: text('codec'),
    bitrate: integer('bitrate'),
    fps: integer('fps'),

    uploadSessionId: text('upload_session_id'),
    uploadedParts: jsonb('uploaded_parts').$type<number[]>(),

    processingAttempts: integer('processing_attempts').default(0),
    lastError: text('last_error'),

    isPublic: boolean('is_public').default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
});

export const segments = pgTable('segments', {
    videoId: text('video_id').references(() => videos.id, { onDelete: 'cascade' }).notNull(),
    idx: integer('idx').notNull(),
    url: text('url').notNull(),
    start: real('start').notNull(),
    duration: real('duration').notNull(),
    size: integer('size'),
    keyframe: boolean('keyframe').default(false),
}, (table) => {
    return {
        pk: primaryKey({ columns: [table.videoId, table.idx] }),
    };
});

export const uploadSessions = pgTable('upload_sessions', {
    id: text('id').primaryKey(),
    videoId: text('video_id').references(() => videos.id, { onDelete: 'cascade' }).notNull(),
    multipartUploadId: text('multipart_upload_id'),
    totalParts: integer('total_parts'),
    uploadedParts: jsonb('uploaded_parts').$type<Array<{ PartNumber: number; ETag: string }>>(),
    status: text('status').notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
});

export type Video = typeof videos.$inferSelect;
export type NewVideo = typeof videos.$inferInsert;
export type Segment = typeof segments.$inferSelect;
export type NewSegment = typeof segments.$inferInsert;
export type UploadSession = typeof uploadSessions.$inferSelect;
export type NewUploadSession = typeof uploadSessions.$inferInsert;
