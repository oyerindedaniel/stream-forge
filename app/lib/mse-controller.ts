export interface VideoQuality {
    quality: string;
    height: number;
    bitrate: string;
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

    private initialized = false;
    private isAppending = false;
    private bufferedSegments = new Set<number>();
    private currentSegmentIndex = -1;

    constructor(videoElement: HTMLVideoElement, manifest: VideoManifest, private baseUrl: string, initialQuality?: string) {
        this.videoElement = videoElement;
        this.manifest = manifest;

        // Select initial quality (default to middle quality)
        const targetQuality = initialQuality || this.selectInitialQuality();
        this.currentQuality = manifest.qualities.find(q => q.quality === targetQuality) || manifest.qualities[0];

        this.mediaSource = new MediaSource();
        this.videoElement.src = URL.createObjectURL(this.mediaSource);

        this.mediaSource.addEventListener('sourceopen', this.onSourceOpen.bind(this));
        this.videoElement.addEventListener('timeupdate', this.onTimeUpdate.bind(this));
        this.videoElement.addEventListener('seeking', this.onSeeking.bind(this));
    }

    private selectInitialQuality(): string {
        // Auto-select based on screen size and network
        const screenHeight = window.screen.height;

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

        this.initialized = true;
        console.log(`MSE Initialized with quality: ${this.currentQuality.quality}`);

        await this.loadInitSegment();
        await this.loadSegment(0);
        await this.loadSegment(1);
    }

    private async loadInitSegment() {
        try {
            console.log(`Fetching Init: ${this.currentQuality.initSegmentUrl}`);
            const url = `${this.baseUrl}/${this.currentQuality.initSegmentUrl}`;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Failed to fetch init segment: ${response.statusText}`);
            }

            const data = await response.arrayBuffer();
            this.appendBuffer(data);
        } catch (e) {
            console.error("Failed to load init segment", e);
        }
    }

    public async loadSegment(index: number) {
        if (index >= this.currentQuality.segments.length || index < 0) return;
        if (this.bufferedSegments.has(index)) return;

        const seg = this.currentQuality.segments[index];
        console.log(`Fetching Segment ${index}: ${seg.url}`);

        this.bufferedSegments.add(index);

        try {
            const url = `${this.baseUrl}/${seg.url}`;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Failed to fetch segment: ${response.statusText}`);
            }

            const data = await response.arrayBuffer();
            this.appendBuffer(data);
        } catch (e) {
            console.error(`Failed to load segment ${index}`, e);
            this.bufferedSegments.delete(index);
        }
    }

    private appendBuffer(data: ArrayBuffer) {
        if (this.sourceBuffer && !this.sourceBuffer.updating && this.queue.length === 0) {
            try {
                this.sourceBuffer.appendBuffer(data);
                this.isAppending = true;
            } catch (e) {
                console.error("Append error", e);
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
                    console.error("Queue append error", e);
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
                console.error("Eviction error", e);
            }
        }
    }

    private onTimeUpdate() {
        const time = this.videoElement.currentTime;
        const currentSegmentIndex = this.currentQuality.segments.findIndex(
            s => time >= s.start && time < (s.start + s.duration)
        );

        if (currentSegmentIndex !== -1) {
            this.currentSegmentIndex = currentSegmentIndex;

            this.loadSegment(currentSegmentIndex + 1);
            this.loadSegment(currentSegmentIndex + 2);
            this.loadSegment(currentSegmentIndex + 3);
        }
    }

    private onSeeking() {
        const time = this.videoElement.currentTime;
        const segmentIndex = this.currentQuality.segments.findIndex(
            s => time >= s.start && time < (s.start + s.duration)
        );

        if (segmentIndex !== -1 && !this.bufferedSegments.has(segmentIndex)) {
            this.loadSegment(segmentIndex);
        }
    }

    public async switchQuality(qualityName: string) {
        const newQuality = this.manifest.qualities.find(q => q.quality === qualityName);
        if (!newQuality || newQuality === this.currentQuality) return;

        console.log(`Switching quality from ${this.currentQuality.quality} to ${newQuality.quality}`);

        const currentTime = this.videoElement.currentTime;
        const wasPlaying = !this.videoElement.paused;

        // Clear current buffer
        this.bufferedSegments.clear();
        this.queue = [];

        if (this.sourceBuffer && !this.sourceBuffer.updating) {
            try {
                this.sourceBuffer.remove(0, this.videoElement.duration);
            } catch (e) {
                console.error('Failed to clear buffer:', e);
            }
        }

        // Switch to new quality
        this.currentQuality = newQuality;

        // Reload from current time
        await this.loadInitSegment();

        const startSegment = this.currentQuality.segments.findIndex(
            s => currentTime >= s.start && currentTime < (s.start + s.duration)
        );

        if (startSegment !== -1) {
            await this.loadSegment(startSegment);
            await this.loadSegment(startSegment + 1);
        }

        this.videoElement.currentTime = currentTime;
        if (wasPlaying) {
            this.videoElement.play();
        }
    }

    public getAvailableQualities(): string[] {
        return this.manifest.qualities.map(q => q.quality);
    }

    public getCurrentQuality(): string {
        return this.currentQuality.quality;
    }

    public seek(time: number) {
        this.videoElement.currentTime = time;
    }

    public destroy() {
        if (this.mediaSource.readyState === 'open') {
            try {
                this.mediaSource.endOfStream();
            } catch (e) {
                console.error('Error ending stream', e);
            }
        }

        this.videoElement.removeEventListener('timeupdate', this.onTimeUpdate.bind(this));
        this.videoElement.removeEventListener('seeking', this.onSeeking.bind(this));
    }
}
