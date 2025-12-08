'use client';

import { useParams } from 'next/navigation';
import { useEffect } from 'react';
import { SmartVideo } from '@/components/smart-video';
import { VideoManifest } from '@/app/lib/mse-controller';
import { useQuery } from '@tanstack/react-query';
import { useSocket } from '@/app/contexts/socket-context';
import { API_URL } from '@/app/lib/constants';

interface VideoData {
    id: string;
    title: string;
    status: string;
    manifestUrl?: string;
    duration?: number;
    width?: number;
    height?: number;
}

async function fetchVideo(id: string): Promise<VideoData> {
    const res = await fetch(`${API_URL}/api/v1/videos/${id}`);
    if (!res.ok) throw new Error('Failed to fetch video');
    return res.json();
}

async function fetchManifest(manifestUrl: string): Promise<VideoManifest> {
    const url = `${API_URL}/${manifestUrl}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch manifest');
    return res.json();
}

export default function VideoPage() {
    const { id } = useParams();
    const videoId = Array.isArray(id) ? id[0] : id;
    const { subscribeToVideo, unsubscribeFromVideo, onVideoStatus } = useSocket();

    const { data: video, refetch } = useQuery({
        queryKey: ['video', videoId],
        queryFn: () => fetchVideo(videoId!),
        enabled: !!videoId,
    });

    const { data: manifest } = useQuery({
        queryKey: ['manifest', videoId],
        queryFn: () => fetchManifest(video!.manifestUrl!),
        enabled: !!video?.manifestUrl && video.status === 'ready',
    });

    useEffect(() => {
        if (!videoId) return;

        subscribeToVideo(videoId);

        const cleanup = onVideoStatus((event) => {
            if (event.videoId === videoId) {
                console.log('[Video Page] Status update:', event);
                refetch();
            }
        });

        return () => {
            unsubscribeFromVideo(videoId);
            cleanup();
        };
    }, [videoId, subscribeToVideo, unsubscribeFromVideo, onVideoStatus, refetch]);

    if (!video) {
        return <div className="p-10 text-center">Loading...</div>;
    }

    return (
        <div className="min-h-screen bg-black text-white p-6 flex flex-col items-center">
            <div className="w-full max-w-5xl space-y-4">
                <h1 className="text-2xl font-bold">{video.title}</h1>

                {video.status === 'ready' && manifest ? (
                    <SmartVideo
                        baseUrl={`${API_URL}/files/${videoId}`}
                        manifest={manifest}
                    />
                ) : (
                    <div className="aspect-video bg-zinc-900 flex flex-col items-center justify-center rounded border border-zinc-800">
                        {video.status === 'processing' && (
                            <>
                                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
                                <p className="text-lg">Processing video...</p>
                                <p className="text-sm text-zinc-500 mt-2">Generating multiple quality variants (360p, 720p, 1080p)</p>
                            </>
                        )}
                        {video.status === 'pending_upload' && (
                            <p>Upload pending...</p>
                        )}
                        {video.status === 'uploading' && (
                            <>
                                <div className="animate-pulse">
                                    <svg className="w-12 h-12 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                    </svg>
                                </div>
                                <p className="text-lg mt-4">Uploading...</p>
                            </>
                        )}
                        {video.status === 'failed' && (
                            <>
                                <p className="text-red-500 text-lg">Processing failed</p>
                                <p className="text-sm text-zinc-500 mt-2">Please try uploading again</p>
                            </>
                        )}
                    </div>
                )}

                <div className="p-4 bg-zinc-900 rounded">
                    <h2 className="font-semibold text-lg">Details</h2>
                    <div className="mt-2 space-y-1 text-sm">
                        <p><span className="text-zinc-500">Status:</span> <span className="capitalize">{video.status.replace('_', ' ')}</span></p>
                        {video.duration && (
                            <p><span className="text-zinc-500">Duration:</span> {Math.floor(video.duration / 60)}:{String(Math.floor(video.duration % 60)).padStart(2, '0')}</p>
                        )}
                        {video.width && video.height && (
                            <p><span className="text-zinc-500">Resolution:</span> {video.width}x{video.height}</p>
                        )}
                        {manifest && (
                            <p><span className="text-zinc-500">Available Qualities:</span> {manifest.qualities.map(q => q.quality).join(', ')}</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
