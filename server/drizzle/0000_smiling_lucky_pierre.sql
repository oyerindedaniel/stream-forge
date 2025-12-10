CREATE TYPE "public"."upload_session_status" AS ENUM('active', 'completed', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."video_status" AS ENUM('pending_upload', 'uploading', 'processing', 'ready', 'failed', 'cancelled', 'deleted');--> statement-breakpoint
CREATE TABLE "segments" (
	"video_id" text NOT NULL,
	"idx" integer NOT NULL,
	"url" text NOT NULL,
	"start" real NOT NULL,
	"duration" real NOT NULL,
	"size" integer,
	"keyframe" boolean DEFAULT false,
	CONSTRAINT "segments_video_id_idx_pk" PRIMARY KEY("video_id","idx")
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"video_id" text NOT NULL,
	"multipart_upload_id" text,
	"total_parts" integer,
	"uploaded_parts" jsonb,
	"status" "upload_session_status" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"status" "video_status" DEFAULT 'pending_upload' NOT NULL,
	"source_url" text NOT NULL,
	"source_size" integer NOT NULL,
	"source_checksum" text,
	"manifest_url" text,
	"init_segment_url" text,
	"keyframe_index_url" text,
	"thumbnails" jsonb,
	"duration" real,
	"width" integer,
	"height" integer,
	"codec" text,
	"bitrate" integer,
	"fps" integer,
	"upload_session_id" text,
	"uploaded_parts" jsonb,
	"processing_attempts" integer DEFAULT 0,
	"last_error" text,
	"is_public" boolean DEFAULT false,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "segments" ADD CONSTRAINT "segments_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "segments_video_id_idx" ON "segments" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "upload_sessions_video_id_idx" ON "upload_sessions" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "upload_sessions_status_idx" ON "upload_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "upload_sessions_expires_at_idx" ON "upload_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "videos_status_idx" ON "videos" USING btree ("status");--> statement-breakpoint
CREATE INDEX "videos_created_at_idx" ON "videos" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "videos_is_public_idx" ON "videos" USING btree ("is_public");--> statement-breakpoint
CREATE INDEX "videos_status_created_idx" ON "videos" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "videos_deleted_at_idx" ON "videos" USING btree ("deleted_at");