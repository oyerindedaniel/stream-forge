import { cacheDB } from './cache-db';

export class ThumbnailStore {
    private baseUrl: string;
    private pattern: string;
    private interval: number;
    private videoId: string;

    constructor(baseUrl: string, pattern: string, interval: number, videoId: string) {
        this.baseUrl = baseUrl;
        this.pattern = pattern;
        this.interval = interval;
        this.videoId = videoId;
    }

    async getThumbnailForTime(time: number): Promise<string | null> {
        const index = Math.floor(time / this.interval) + 1;
        const cacheKey = `${this.videoId}:thumb:${index}`;

        try {
            const cachedBlob = await cacheDB.getThumbnail(cacheKey);
            if (cachedBlob) {
                return URL.createObjectURL(cachedBlob);
            }
        } catch (error) {
            console.warn(`[Thumbnail] Cache read error for ${cacheKey}:`, error);
        }

        const paddedIndex = String(index).padStart(3, '0');
        const url = `${this.baseUrl}/${this.pattern.replace('%03d', paddedIndex)}`;

        try {
            const response = await fetch(url);
            if (response.ok) {
                const blob = await response.blob();

                try {
                    await cacheDB.cacheThumbnail({
                        key: cacheKey,
                        blob,
                        timestamp: Date.now(),
                        time,
                        videoId: this.videoId,
                    });
                } catch (error) {
                    console.warn(`[Thumbnail] Cache write error for ${cacheKey}:`, error);
                }

                return URL.createObjectURL(blob);
            }
        } catch (e) {
            console.error(`[Thumbnail] Failed to load for time ${time}`, e);
        }

        return null;
    }

    preloadThumbnails(startTime: number, endTime: number) {
        const startIndex = Math.floor(startTime / this.interval);
        const endIndex = Math.ceil(endTime / this.interval);

        for (let i = startIndex; i <= endIndex; i++) {
            const time = i * this.interval;
            this.getThumbnailForTime(time);
        }
    }

    async clearCache() {
        console.log(`[Thumbnail] Clearing cache for video ${this.videoId}`);
        await cacheDB.clearThumbnailsForVideo(this.videoId);
    }
}
