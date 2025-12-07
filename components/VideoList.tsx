'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface Video {
    id: string;
    title: string;
    status: string;
    createdAt: string;
    manifestUrl?: string;
    thumbnailUrl?: string; // We might want to compute this or store it
}

export function VideoList() {
    const [videos, setVideos] = useState<Video[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchVideos = async () => {
        try {
            const res = await fetch(`${API_URL}/api/v1/videos`);
            const data = await res.json();
            setVideos(data.videos || []);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchVideos();
        const interval = setInterval(fetchVideos, 5000); // Polling for updates
        return () => clearInterval(interval);
    }, []);
    if (loading && videos.length === 0) return <div className="text-muted-foreground p-4">Loading videos...</div>;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 p-6">
            {videos.map((video) => (
                <Link href={`/video/${video.id}`} key={video.id} className="block group">
                    <div className="border border-border rounded-lg overflow-hidden bg-card hover:shadow-lg transition-all hover:border-primary">
                        <div className="aspect-video bg-muted relative flex items-center justify-center group-hover:bg-muted/80 transition-colors">
                            <span className="text-muted-foreground text-sm uppercase tracking-wider font-semibold">
                                {video.status}
                            </span>
                        </div>
                        <div className="p-4">
                            <h4 className="font-semibold truncate text-foreground group-hover:text-primary transition-colors">{video.title || 'Untitled Video'}</h4>
                            <div className="flex justify-between items-center mt-2 text-xs text-muted-foreground">
                                <span>{video.status}</span>
                                <span>{new Date(video.createdAt).toLocaleDateString()}</span>
                            </div>
                        </div>
                    </div>
                </Link>
            ))}
            {videos.length === 0 && (
                <div className="col-span-full text-center py-12 text-muted-foreground">
                    No videos found. Upload one to get started!
                </div>
            )}
        </div>
    );
}
