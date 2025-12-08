import { VideoQualityName } from "./constants";

export const S3Keys = {
    /**
     * Source video uploaded by user
     * Format: sources/{videoId}/original.{ext}
     */
    source: (videoId: string, filename: string) => {
        const ext = filename.split(".").pop() || "mp4";
        return `sources/${videoId}/original.${ext}`;
    },

    /**
     * Processed video manifest
     * Format: processed/{videoId}/manifest.json
     */
    manifest: (videoId: string) => {
        return `processed/${videoId}/manifest.json`;
    },

    /**
     * Init segment for a specific quality
     * Format: processed/{videoId}/{quality}/init.mp4
     */
    initSegment: (videoId: string, quality: string) => {
        return `processed/${videoId}/${quality}/init.mp4`;
    },

    /**
     * Media segment for a specific quality
     * Format: processed/{videoId}/{quality}/seg_{index}.m4s
     */
    mediaSegment: (videoId: string, quality: string, index: number) => {
        return `processed/${videoId}/${quality}/seg_${index}.m4s`;
    },

    /**
     * Thumbnail image
     * Format: processed/{videoId}/thumbnails/thumb_{index}.jpg
     */
    thumbnail: (videoId: string, index: number) => {
        const paddedIndex = String(index).padStart(3, "0");
        return `processed/${videoId}/thumbnails/thumb_${paddedIndex}.jpg`;
    },

    /**
     * Thumbnail sprite sheet (optional)
     * Format: processed/{videoId}/thumbnails/sprite.jpg
     */
    thumbnailSprite: (videoId: string) => {
        return `processed/${videoId}/thumbnails/sprite.jpg`;
    },

    /**
     * Keyframe index file
     * Format: processed/{videoId}/keyframes.json
     */
    keyframeIndex: (videoId: string) => {
        return `processed/${videoId}/keyframes.json`;
    },

    /**
     * Get the folder prefix for a video
     * Format: processed/{videoId}/
     */
    videoFolder: (videoId: string) => {
        return `processed/${videoId}/`;
    },

    /**
     * Parse videoId from an S3 key
     */
    parseVideoId: (key: string): string | null => {
        const match = key.match(/(?:sources|processed)\/([^\/]+)\//);
        return match ? match[1] : null;
    },

    /**
     * Parse quality from a processed file key
     */
    parseQuality: (key: string): string | null => {
        const match = key.match(/processed\/[^\/]+\/([^\/]+)\//);
        return match ? match[1] : null;
    },

    /**
     * Check if key is a source video
     */
    isSource: (key: string): boolean => {
        return key.startsWith("sources/");
    },

    /**
     * Check if key is a processed file
     */
    isProcessed: (key: string): boolean => {
        return key.startsWith("processed/");
    },

    /**
     * Parse S3 URL to extract the key
     * Converts "s3://bucket-name/path/to/file.mp4" to "path/to/file.mp4"
     * @param s3Url - Full S3 URL in format s3://bucket-name/key
     * @param bucketName - The bucket name to strip from the URL
     * @returns The S3 key without the bucket prefix
     * @example
     * S3Keys.parseS3Url("s3://my-bucket/videos/123/original.mp4", "my-bucket")
     * // Returns: "videos/123/original.mp4"
     */
    parseS3Url: (s3Url: string, bucketName: string): string => {
        return s3Url.replace(`s3://${bucketName}/`, "");
    },
};

export function getQualitySegmentKeys(
    videoId: string,
    quality: VideoQualityName,
    segmentCount: number
): string[] {
    const keys: string[] = [S3Keys.initSegment(videoId, quality)];

    for (let i = 0; i < segmentCount; i++) {
        keys.push(S3Keys.mediaSegment(videoId, quality, i));
    }

    return keys;
}

export function getThumbnailKeys(
    videoId: string,
    thumbnailCount: number
): string[] {
    const keys: string[] = [];

    for (let i = 1; i <= thumbnailCount; i++) {
        keys.push(S3Keys.thumbnail(videoId, i));
    }

    return keys;
}
