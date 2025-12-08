
import { SegmentFetcher } from './segment-fetcher';
import { VideoQuality as VideoQualityConfig } from './constants';

export interface VideoQuality {
    quality: VideoQualityConfig;
    height: number;
    bitrate: string; // bitrate: "800k" | "2500k" | "5000k"
    codec: string;
    initSegmentUrl: string;
    segments: {
        url: string;
        start: number;
        duration: number;
        index: number;
    }[];
}

export interface VideoManifest {
    videoId: string;
    duration: number;
    width: number;
    height: number;
    qualities: VideoQuality[];
    thumbnails?: {
        pattern: string;
        interval: number;
    };
}

export class MSEController {
    private videoElement: HTMLVideoElement;
    private mediaSource: MediaSource;
    private sourceBuffer: SourceBuffer | null = null;
    private queue: ArrayBuffer[] = [];
    private manifest: VideoManifest;
    private currentQuality: VideoQuality;
    private segmentFetcher: SegmentFetcher;

    private initialized = false;
    private isAppending = false;
    private bufferedSegments = new Set<number>();
    private currentSegmentIndex = -1;
    private isAdaptiveEnabled = true;
    private lastQualityCheck = 0;
    private readonly QUALITY_CHECK_INTERVAL = 10000;

    constructor(
        videoElement: HTMLVideoElement,
        manifest: VideoManifest,
        private baseUrl: string,
        initialQuality?: string
    ) {
        this.videoElement = videoElement;
        this.manifest = manifest;
        this.segmentFetcher = new SegmentFetcher(baseUrl, manifest.videoId);

        const targetQuality = initialQuality || this.selectInitialQuality();
        this.currentQuality =
            manifest.qualities.find((q) => q.quality === targetQuality) || manifest.qualities[0];

        this.mediaSource = new MediaSource();
        this.videoElement.src = URL.createObjectURL(this.mediaSource);

        this.mediaSource.addEventListener('sourceopen', this.onSourceOpen.bind(this));
        this.videoElement.addEventListener('timeupdate', this.onTimeUpdate.bind(this));
        this.videoElement.addEventListener('seeking', this.onSeeking.bind(this));
        this.videoElement.addEventListener('waiting', this.onWaiting.bind(this));
    }

    private selectInitialQuality(): VideoQualityConfig {
        const screenHeight = window.screen.height;
        const connection = (navigator as any).connection;

        if (connection) {
            const downlink = connection.downlink;

            if (downlink < 1.5) return '360p';
            if (downlink < 5 && screenHeight < 1080) return '720p';
        }

        if (screenHeight >= 1080) return '1080p';
        if (screenHeight >= 720) return '720p';
        return '360p';
    }

    private async onSourceOpen() {
        if (this.initialized) return;

        const codec = this.currentQuality.codec || 'video/mp4; codecs="avc1.64001f, mp4a.40.2"';

        if (!MediaSource.isTypeSupported(codec)) {
            console.error(`Codec ${codec} not supported`);
            return;
        }

        this.sourceBuffer = this.mediaSource.addSourceBuffer(codec);
        this.sourceBuffer.addEventListener('updateend', this.onUpdateEnd.bind(this));
        this.sourceBuffer.mode = 'sequence';

        this.initialized = true;
        console.log(`[MSE] Initialized with quality: ${this.currentQuality.quality}`);

        await this.loadInitSegment();
        await this.loadSegment(0);
        await this.loadSegment(1);
        await this.loadSegment(2);
    }

    private async loadInitSegment() {
        try {
            console.log(`[MSE] Loading init segment: ${this.currentQuality.initSegmentUrl}`);
            const data = await this.segmentFetcher.fetchSegment(
                this.currentQuality.initSegmentUrl,
                this.currentQuality.quality
            );
            this.appendBuffer(data);
        } catch (e) {
            console.error('[MSE] Failed to load init segment', e);
        }
    }

    public async loadSegment(index: number) {
        if (index >= this.currentQuality.segments.length || index < 0) return;
        if (this.bufferedSegments.has(index)) return;

        const seg = this.currentQuality.segments[index];
        this.bufferedSegments.add(index);

        try {
            const data = await this.segmentFetcher.fetchSegment(seg.url, this.currentQuality.quality);
            this.appendBuffer(data);
        } catch (e) {
            console.error(`[MSE] Failed to load segment ${index}`, e);
            this.bufferedSegments.delete(index);
        }
    }

    private appendBuffer(data: ArrayBuffer) {
        if (this.sourceBuffer && !this.sourceBuffer.updating && this.queue.length === 0) {
            try {
                this.sourceBuffer.appendBuffer(data);
                this.isAppending = true;
            } catch (e) {
                console.error('[MSE] Append error', e);
                if (e instanceof DOMException && e.name === 'QuotaExceededError') {
                    this.handleQuotaExceeded();
                    this.queue.push(data);
                }
            }
        } else {
            this.queue.push(data);
        }
    }

    private onUpdateEnd() {
        this.isAppending = false;

        if (this.queue.length > 0 && this.sourceBuffer && !this.sourceBuffer.updating) {
            const nextData = this.queue.shift();
            if (nextData) {
                try {
                    this.sourceBuffer.appendBuffer(nextData);
                    this.isAppending = true;
                } catch (e) {
                    console.error('[MSE] Queue append error', e);
                    if (e instanceof DOMException && e.name === 'QuotaExceededError') {
                        this.handleQuotaExceeded();
                        this.queue.unshift(nextData);
                    }
                }
            }
        }
    }

    private handleQuotaExceeded() {
        if (!this.sourceBuffer || this.sourceBuffer.updating) return;

        const currentTime = this.videoElement.currentTime;
        const removeEnd = Math.max(0, currentTime - 30);

        if (removeEnd > 0) {
            try {
                this.sourceBuffer.remove(0, removeEnd);

                for (let i = 0; i < this.currentQuality.segments.length; i++) {
                    const seg = this.currentQuality.segments[i];
                    if (seg.start + seg.duration < removeEnd) {
                        this.bufferedSegments.delete(i);
                    }
                }
            } catch (e) {
                console.error('[MSE] Eviction error', e);
            }
        }
    }

    private onTimeUpdate() {
        const time = this.videoElement.currentTime;
        const currentSegmentIndex = this.currentQuality.segments.findIndex(
            (s) => time >= s.start && time < s.start + s.duration
        );

        if (currentSegmentIndex !== -1) {
            this.currentSegmentIndex = currentSegmentIndex;

            const bufferAhead = this.getBufferAhead(time);
            const prefetchCount = bufferAhead < 5 ? 4 : 3;

            for (let i = 1; i <= prefetchCount; i++) {
                this.loadSegment(currentSegmentIndex + i);
            }
        }

        if (this.isAdaptiveEnabled) {
            this.checkAdaptiveQuality();
        }
    }

    private getBufferAhead(currentTime: number): number {
        if (!this.sourceBuffer) return 0;

        const buffered = this.sourceBuffer.buffered;
        for (let i = 0; i < buffered.length; i++) {
            if (currentTime >= buffered.start(i) && currentTime <= buffered.end(i)) {
                return buffered.end(i) - currentTime;
            }
        }
        return 0;
    }

    private onWaiting() {
        console.log('[MSE] Buffering...');
        const currentIndex = this.currentSegmentIndex;
        if (currentIndex !== -1) {
            this.loadSegment(currentIndex + 1);
            this.loadSegment(currentIndex + 2);
        }
    }

    private checkAdaptiveQuality() {
        const now = Date.now();
        if (now - this.lastQualityCheck < this.QUALITY_CHECK_INTERVAL) return;

        this.lastQualityCheck = now;

        const recommended = this.segmentFetcher.getRecommendedQuality(
            this.manifest.qualities.map((q) => ({ quality: q.quality, bitrate: q.bitrate }))
        );

        if (recommended !== this.currentQuality.quality) {
            console.log(
                `[Adaptive] Switching from ${this.currentQuality.quality} to ${recommended} based on network speed`
            );
            this.switchQuality(recommended);
        }
    }

    private onSeeking() {
        const time = this.videoElement.currentTime;
        const segmentIndex = this.currentQuality.segments.findIndex(
            (s) => time >= s.start && time < s.start + s.duration
        );

        if (segmentIndex !== -1) {
            this.loadSegment(segmentIndex);
            this.loadSegment(segmentIndex + 1);
        }
    }

    public async switchQuality(qualityName: VideoQualityConfig) {
        const newQuality = this.manifest.qualities.find((q) => q.quality === qualityName);
        if (!newQuality || newQuality === this.currentQuality) return;

        console.log(`[MSE] Switching quality from ${this.currentQuality.quality} to ${newQuality.quality}`);

        const currentTime = this.videoElement.currentTime;
        const wasPlaying = !this.videoElement.paused;

        this.bufferedSegments.clear();
        this.queue = [];

        if (this.sourceBuffer && !this.sourceBuffer.updating) {
            try {
                const buffered = this.sourceBuffer.buffered;
                if (buffered.length > 0) {
                    this.sourceBuffer.remove(0, buffered.end(buffered.length - 1));
                }
            } catch (e) {
                console.error('[MSE] Failed to clear buffer:', e);
            }
        }

        this.currentQuality = newQuality;

        await this.loadInitSegment();

        const startSegment = this.currentQuality.segments.findIndex(
            (s) => currentTime >= s.start && currentTime < s.start + s.duration
        );

        if (startSegment !== -1) {
            await this.loadSegment(startSegment);
            await this.loadSegment(startSegment + 1);
            await this.loadSegment(startSegment + 2);
        }

        this.videoElement.currentTime = currentTime;
        if (wasPlaying) {
            this.videoElement.play();
        }
    }

    public getAvailableQualities(): string[] {
        return this.manifest.qualities.map((q) => q.quality);
    }

    public getCurrentQuality(): string {
        return this.currentQuality.quality;
    }

    public getNetworkSpeed(): number {
        return this.segmentFetcher.getNetworkSpeed();
    }

    public setAdaptiveEnabled(enabled: boolean) {
        this.isAdaptiveEnabled = enabled;
    }

    public seek(time: number) {
        this.videoElement.currentTime = time;
    }

    public destroy() {
        if (this.mediaSource.readyState === 'open') {
            try {
                this.mediaSource.endOfStream();
            } catch (e) {
                console.error('[MSE] Error ending stream', e);
            }
        }

        this.videoElement.removeEventListener('timeupdate', this.onTimeUpdate.bind(this));
        this.videoElement.removeEventListener('seeking', this.onSeeking.bind(this));
        this.videoElement.removeEventListener('waiting', this.onWaiting.bind(this));

        this.segmentFetcher.clearCache();
    }
}
