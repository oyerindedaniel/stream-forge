export class SegmentFetcher {
    private baseUrl: string;
    private cache = new Map<string, ArrayBuffer>();

    constructor(baseUrl: string) {
        this.baseUrl = baseUrl;
    }

    async fetchSegment(url: string): Promise<ArrayBuffer> {
        const fetchUrl = url.startsWith('http') ? url : `${this.baseUrl}/${url}`;

        if (this.cache.has(fetchUrl)) {
            return this.cache.get(fetchUrl)!;
        }

        const response = await fetch(fetchUrl);
        if (!response.ok) {
            throw new Error(`Failed to fetch segment ${url}: ${response.statusText}`);
        }

        const data = await response.arrayBuffer();

        if (this.cache.size < 50) {
            this.cache.set(fetchUrl, data);
        }

        return data;
    }

    clearCache() {
        this.cache.clear();
    }
}
