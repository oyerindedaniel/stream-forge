ALTER TABLE "videos" ADD COLUMN "part_checksums" jsonb;--> statement-breakpoint
ALTER TABLE "videos" DROP COLUMN "source_checksum";