import { cacheDB } from './cache-db';
import { VideoQuality } from './constants';

export class SegmentFetcher {
    private baseUrl: string;
    private videoId: string;
    private networkSpeed: number = 0;
    private lastFetchTime: number = 0;
    private lastFetchSize: number = 0;

    constructor(baseUrl: string, videoId: string) {
        this.baseUrl = baseUrl;
        this.videoId = videoId;
    }

    async fetchSegment(url: string, quality: string): Promise<ArrayBuffer> {
        const fetchUrl = url.startsWith('http') ? url : `${this.baseUrl}/${url}`;
        const cacheKey = `${this.videoId}:${quality}:${url}`;

        let cached: ArrayBuffer | null = null;
        try {
            cached = await cacheDB.getSegment(cacheKey);
            if (cached) {
                console.log(`[Cache HIT] ${url}`);
                return cached;
            }
        } catch (error) {
            console.warn(`[Cache ERROR] Failed to read cache for ${url}:`, error);
        }

        console.log(`[Cache MISS] Fetching ${url}`);
        const startTime = performance.now();

        const response = await fetch(fetchUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch segment ${url}: ${response.statusText}`);
        }

        const data = await response.arrayBuffer();
        const endTime = performance.now();

        this.updateNetworkSpeed(data.byteLength, endTime - startTime);

        try {
            await cacheDB.cacheSegment({
                key: cacheKey,
                data,
                timestamp: Date.now(),
                size: data.byteLength,
                quality,
                videoId: this.videoId,
            });
        } catch (error) {
            console.warn(`[Cache ERROR] Failed to cache ${url}:`, error);
        }

        return data;
    }

    private updateNetworkSpeed(bytes: number, timeMs: number) {
        const speedMbps = (bytes * 8) / (timeMs * 1000);

        if (this.networkSpeed === 0) {
            this.networkSpeed = speedMbps;
        } else {
            this.networkSpeed = this.networkSpeed * 0.7 + speedMbps * 0.3;
        }

        this.lastFetchTime = timeMs;
        this.lastFetchSize = bytes;
    }

    getNetworkSpeed(): number {
        return this.networkSpeed;
    }

    getRecommendedQuality(availableQualities: Array<{ quality: VideoQuality; bitrate: string }>): VideoQuality {
        const sorted = [...availableQualities].sort((a, b) => {
            const bitrateA = parseInt(a.bitrate.replace(/k$/i, ''), 10);
            const bitrateB = parseInt(b.bitrate.replace(/k$/i, ''), 10);
            return bitrateA - bitrateB;
        });

        if (this.networkSpeed === 0) {
            const lowestQuality = sorted[0]?.quality || '360p';
            console.log(`[Quality] No network data - starting with lowest: ${lowestQuality}`);
            return lowestQuality;
        }

        const safeBandwidth = this.networkSpeed * 0.8;

        for (let i = sorted.length - 1; i >= 0; i--) {
            const bitrateKbps = parseInt(sorted[i].bitrate.replace(/k$/i, ''), 10);
            const bitrateMbps = bitrateKbps / 1000;

            if (bitrateMbps <= safeBandwidth) {
                console.log(
                    `[Quality] Selected ${sorted[i].quality} (${bitrateMbps.toFixed(2)}Mbps) ` +
                    `for ${safeBandwidth.toFixed(2)}Mbps safe bandwidth`
                );
                return sorted[i].quality;
            }
        }

        const fallbackQuality = sorted[0]?.quality || '360p';
        console.log(`[Quality] No quality fits bandwidth - using lowest: ${fallbackQuality}`);
        return fallbackQuality;
    }

    async clearCache() {
        console.log(`[SegmentFetcher] Clearing cache for video ${this.videoId}`);
        await cacheDB.clearSegmentsForVideo(this.videoId);
    }
}
