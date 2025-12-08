import { openDB, DBSchema, IDBPDatabase } from 'idb';

const DB_NAME = 'streamforge-cache';
const DB_VERSION = 1;
const SEGMENT_STORE = 'segments';
const THUMBNAIL_STORE = 'thumbnails';
const MAX_CACHE_SIZE_MB = 500;

export interface CachedSegment {
    key: string;
    data: ArrayBuffer;
    timestamp: number;
    size: number;
    quality: string;
    videoId: string;
}

export interface CachedThumbnail {
    key: string;
    blob: Blob;
    timestamp: number;
    time: number;
    videoId: string;
}

interface StreamForgeDB extends DBSchema {
    segments: {
        key: string;
        value: CachedSegment;
        indexes: {
            'videoId': string;
            'timestamp': number;
            'quality': string;
        };
    };
    thumbnails: {
        key: string;
        value: CachedThumbnail;
        indexes: {
            'videoId': string;
            'timestamp': number;
        };
    };
}

export class IndexedDBCache {
    private dbPromise: Promise<IDBPDatabase<StreamForgeDB>>;

    constructor() {
        this.dbPromise = openDB<StreamForgeDB>(DB_NAME, DB_VERSION, {
            upgrade(db) {
                if (!db.objectStoreNames.contains(SEGMENT_STORE)) {
                    const segmentStore = db.createObjectStore(SEGMENT_STORE, { keyPath: 'key' });
                    segmentStore.createIndex('videoId', 'videoId');
                    segmentStore.createIndex('timestamp', 'timestamp');
                    segmentStore.createIndex('quality', 'quality');
                }

                if (!db.objectStoreNames.contains(THUMBNAIL_STORE)) {
                    const thumbnailStore = db.createObjectStore(THUMBNAIL_STORE, { keyPath: 'key' });
                    thumbnailStore.createIndex('videoId', 'videoId');
                    thumbnailStore.createIndex('timestamp', 'timestamp');
                }
            },
        });
    }

    async cacheSegment(segment: CachedSegment): Promise<void> {
        const db = await this.dbPromise;
        await this.evictIfNecessary(segment.size);
        await db.put(SEGMENT_STORE, segment);
    }

    async getSegment(key: string): Promise<ArrayBuffer | null> {
        const db = await this.dbPromise;
        const segment = await db.get(SEGMENT_STORE, key);

        if (segment) {
            segment.timestamp = Date.now();
            await db.put(SEGMENT_STORE, segment);
            return segment.data;
        }

        return null;
    }

    async cacheThumbnail(thumbnail: CachedThumbnail): Promise<void> {
        const db = await this.dbPromise;
        await db.put(THUMBNAIL_STORE, thumbnail);
    }

    async getThumbnail(key: string): Promise<Blob | null> {
        const db = await this.dbPromise;
        const thumbnail = await db.get(THUMBNAIL_STORE, key);
        return thumbnail?.blob || null;
    }

    async clearSegmentsForVideo(videoId: string): Promise<void> {
        const db = await this.dbPromise;
        const tx = db.transaction(SEGMENT_STORE, 'readwrite');
        const index = tx.store.index('videoId');

        let cursor = await index.openCursor(IDBKeyRange.only(videoId));
        while (cursor) {
            await cursor.delete();
            cursor = await cursor.continue();
        }

        await tx.done;
        console.log(`[Cache] Cleared segments for video ${videoId}`);
    }

    async clearThumbnailsForVideo(videoId: string): Promise<void> {
        const db = await this.dbPromise;
        const tx = db.transaction(THUMBNAIL_STORE, 'readwrite');
        const index = tx.store.index('videoId');

        let cursor = await index.openCursor(IDBKeyRange.only(videoId));
        while (cursor) {
            await cursor.delete();
            cursor = await cursor.continue();
        }

        await tx.done;
        console.log(`[Cache] Cleared thumbnails for video ${videoId}`);
    }

    async clearVideoCache(videoId: string): Promise<void> {
        await Promise.all([
            this.clearSegmentsForVideo(videoId),
            this.clearThumbnailsForVideo(videoId),
        ]);
    }

    private async getCacheSize(): Promise<number> {
        const db = await this.dbPromise;
        const segments = await db.getAll(SEGMENT_STORE);
        return segments.reduce((sum, seg) => sum + seg.size, 0);
    }

    private async evictIfNecessary(newItemSize: number): Promise<void> {
        const currentSize = await this.getCacheSize();
        const maxSize = MAX_CACHE_SIZE_MB * 1024 * 1024;

        if (currentSize + newItemSize > maxSize) {
            await this.evictOldestSegments(currentSize + newItemSize - maxSize);
        }
    }

    private async evictOldestSegments(bytesToRemove: number): Promise<void> {
        const db = await this.dbPromise;
        const tx = db.transaction(SEGMENT_STORE, 'readwrite');
        const index = tx.store.index('timestamp');

        let removedBytes = 0;
        let cursor = await index.openCursor();

        while (cursor && removedBytes < bytesToRemove) {
            const segment = cursor.value;
            removedBytes += segment.size;
            await cursor.delete();
            cursor = await cursor.continue();
        }

        await tx.done;
        console.log(`[Cache] Evicted ${(removedBytes / 1024 / 1024).toFixed(2)}MB of old segments`);
    }

    async clearAllSegments(): Promise<void> {
        const db = await this.dbPromise;
        await db.clear(SEGMENT_STORE);
        console.log('[Cache] Cleared all segments');
    }

    async clearAllThumbnails(): Promise<void> {
        const db = await this.dbPromise;
        await db.clear(THUMBNAIL_STORE);
        console.log('[Cache] Cleared all thumbnails');
    }

    async clearAll(): Promise<void> {
        await Promise.all([
            this.clearAllSegments(),
            this.clearAllThumbnails(),
        ]);
    }
}

export const cacheDB = new IndexedDBCache();
