export class ThumbnailStore {
    private thumbnailCache = new Map<number, string>();
    private baseUrl: string;
    private pattern: string;
    private interval: number;

    constructor(baseUrl: string, pattern: string, interval: number) {
        this.baseUrl = baseUrl;
        this.pattern = pattern;
        this.interval = interval;
    }

    async getThumbnailForTime(time: number): Promise<string | null> {
        const index = Math.floor(time / this.interval) + 1;

        if (this.thumbnailCache.has(index)) {
            return this.thumbnailCache.get(index)!;
        }

        const paddedIndex = String(index).padStart(3, '0');
        const url = `${this.baseUrl}/${this.pattern.replace('%03d', paddedIndex)}`;

        try {
            const response = await fetch(url, { method: 'HEAD' });
            if (response.ok) {
                this.thumbnailCache.set(index, url);
                return url;
            }
        } catch (e) {
            console.error('Failed to load thumbnail', e);
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
}
