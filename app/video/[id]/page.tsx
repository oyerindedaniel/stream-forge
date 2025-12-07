'use client';
import { useParams } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import { SmartVideo } from '@/components/SmartVideo';
import { VideoManifest } from '@/app/lib/mse-controller';
import { io, Socket } from 'socket.io-client';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export default function VideoPage() {
    const { id } = useParams();
    const [video, setVideo] = useState<{
        id: string;
        title: string;
        status: string;
        manifestUrl?: string;
    } | null>(null);
    const [manifest, setManifest] = useState<VideoManifest | undefined>(undefined);
    const [loading, setLoading] = useState(true);
    const [socket, setSocket] = useState<Socket | null>(null);

    useEffect(() => {
        if (!id) return;

        // Fetch initial video metadata
        fetch(`${API_URL}/api/v1/videos/${id}`)
            .then(res => res.json())
            .then(data => {
                setVideo(data);

                if (data.status === 'ready' && data.manifestUrl) {
                    const manifestUrl = `${API_URL}/${data.manifestUrl}`;
                    fetch(manifestUrl)
                        .then(res => res.json())
                        .then(manifestData => {
                            setManifest(manifestData);
                        })
                        .catch(err => console.error("Failed to load manifest", err));
                }
            })
            .catch(console.error)
            .finally(() => setLoading(false));

        // Setup WebSocket connection
        const socketInstance = io(API_URL, {
            transports: ['websocket', 'polling']
        });

        socketInstance.on('connect', () => {
            console.log('[Socket.IO] Connected');
            socketInstance.emit('subscribe:video', id);
        });

        socketInstance.on('video:status', (event: { videoId: string; status: string; error?: string }) => {
            console.log('[Socket.IO] Status update:', event);

            setVideo(prev => prev ? { ...prev, status: event.status } : null);

            if (event.status === 'ready') {
                // Reload video data to get manifest URL
                fetch(`${API_URL}/api/v1/videos/${id}`)
                    .then(res => res.json())
                    .then(data => {
                        setVideo(data);
                        if (data.manifestUrl) {
                            const manifestUrl = `${API_URL}/${data.manifestUrl}`;
                            fetch(manifestUrl)
                                .then(res => res.json())
                                .then(manifestData => {
                                    setManifest(manifestData);
                                })
                                .catch(err => console.error("Failed to load manifest", err));
                        }
                    });
            } else if (event.status === 'failed') {
                setVideo(prev => prev ? { ...prev, status: 'failed' } : null);
            }
        });

        socketInstance.on('disconnect', () => {
            console.log('[Socket.IO] Disconnected');
        });

        setSocket(socketInstance);

        return () => {
            socketInstance.emit('unsubscribe:video', id);
            socketInstance.disconnect();
        };
    }, [id]);

    if (loading) return <div className="p-10 text-center">Loading...</div>;
    if (!video) return <div className="p-10 text-center">Video not found</div>;

    return (
        <div className="min-h-screen bg-black text-white p-6 flex flex-col items-center">
            <div className="w-full max-w-5xl space-y-4">
                <h1 className="text-2xl font-bold">{video.title}</h1>

                {video.status === 'ready' && manifest ? (
                    <SmartVideo
                        baseUrl={`${API_URL}/files/${id}`}
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
                        <p><span className="text-zinc-500">Status:</span> <span className="capitalize">{video.status}</span></p>
                        {manifest && (
                            <>
                                <p><span className="text-zinc-500">Duration:</span> {Math.floor(manifest.duration / 60)}:{String(Math.floor(manifest.duration % 60)).padStart(2, '0')}</p>
                                <p><span className="text-zinc-500">Resolution:</span> {manifest.width}x{manifest.height}</p>
                                <p><span className="text-zinc-500">Available Qualities:</span> {manifest.qualities.map(q => q.quality).join(', ')}</p>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
