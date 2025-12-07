'use client';
import { useState, useRef, useEffect } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks

type UploadStatus = 'uploading' | 'processing' | 'complete' | 'error' | 'paused';

interface UploadProgress {
    uploadId: string;
    filename: string;
    progress: number;
    uploadedBytes: number;
    totalBytes: number;
    status: UploadStatus;
    error?: string;
    uploadedChunks: Set<number>;
    sessionId?: string;
}

interface SavedSession {
    uploadId: string;
    filename: string;
    progress: number;
    uploadedBytes: number;
    totalBytes: number;
    status: UploadStatus;
    error?: string;
    uploadedChunks: number[];
    sessionId?: string;
}

interface UploadSession {
    uploadId: string;
    multipartUploadId?: string;
    partUrls?: string[];
    uploadUrl?: string;
    totalChunks: number;
}

export function Uploader() {
    const [uploads, setUploads] = useState<Record<string, UploadProgress>>({});
    const fileInputRef = useRef<HTMLInputElement>(null);
    const uploadSessionsRef = useRef<Record<string, UploadSession>>({});
    const uploadsPausedRef = useRef<Record<string, boolean>>({});

    useEffect(() => {
        loadSavedSessions();
    }, []);

    const loadSavedSessions = () => {
        const saved = localStorage.getItem('streamforge_uploads');
        if (saved) {
            try {
                const sessions = JSON.parse(saved) as Record<string, SavedSession>;
                Object.values(sessions).forEach((session) => {
                    if (session.status === 'uploading' || session.status === 'paused') {
                        setUploads(prev => ({
                            ...prev,
                            [session.uploadId]: {
                                ...session,
                                status: 'paused',
                                uploadedChunks: new Set(session.uploadedChunks || []),
                            }
                        }));
                    }
                });
            } catch (e) {
                console.error('Failed to load saved sessions:', e);
            }
        }
    };

    const saveSessions = (currentUploads: Record<string, UploadProgress>) => {
        const toSave = Object.fromEntries(
            Object.entries(currentUploads).map(([id, upload]) => [
                id,
                {
                    ...upload,
                    uploadedChunks: Array.from(upload.uploadedChunks),
                }
            ])
        );
        localStorage.setItem('streamforge_uploads', JSON.stringify(toSave));
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;

        for (const file of Array.from(files)) {
            uploadFile(file);
        }

        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const uploadFile = async (file: File, resumeId?: string) => {
        const tempId = resumeId || crypto.randomUUID();

        const initialProgress: UploadProgress = {
            uploadId: tempId,
            filename: file.name,
            progress: 0,
            uploadedBytes: 0,
            totalBytes: file.size,
            status: 'uploading',
            uploadedChunks: new Set(),
        };

        setUploads(prev => {
            const updated = { ...prev, [tempId]: initialProgress };
            saveSessions(updated);
            return updated;
        });

        try {
            const initResponse = await fetch(`${API_URL}/api/v1/uploads`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: file.name,
                    contentType: file.type,
                    size: file.size,
                    metadata: { title: file.name }
                })
            });

            if (!initResponse.ok) {
                throw new Error('Failed to initialize upload');
            }

            const initData = await initResponse.json() as {
                uploadId: string;
                uploadUrl?: string;
                partUrls?: string[];
                multipartUploadId?: string;
                partSize?: number;
            };
            const { uploadId, uploadUrl, partUrls, multipartUploadId, partSize } = initData;

            uploadSessionsRef.current[tempId] = {
                uploadId,
                multipartUploadId,
                partUrls,
                uploadUrl,
                totalChunks: partUrls ? partUrls.length : Math.ceil(file.size / CHUNK_SIZE),
            };

            setUploads(prev => {
                const updated = {
                    ...prev,
                    [tempId]: {
                        ...prev[tempId],
                        uploadId,
                        sessionId: multipartUploadId,
                    }
                };
                saveSessions(updated);
                return updated;
            });

            if (partUrls && multipartUploadId) {
                await uploadChunked(tempId, file, partUrls, partSize || CHUNK_SIZE);
            } else if (uploadUrl) {
                await uploadDirect(tempId, file, uploadUrl);
            }

            const completeResponse = await fetch(`${API_URL}/api/v1/uploads/${uploadId}/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });

            if (!completeResponse.ok) {
                throw new Error('Failed to complete upload');
            }

            setUploads(prev => {
                const updated = {
                    ...prev,
                    [tempId]: { ...prev[tempId], status: 'processing' as UploadStatus, progress: 100 }
                };
                saveSessions(updated);
                return updated;
            });

            pollStatus(uploadId, tempId);

        } catch (error) {
            console.error('Upload error:', error);
            setUploads(prev => {
                const updated = {
                    ...prev,
                    [tempId]: {
                        ...prev[tempId],
                        status: 'error' as UploadStatus,
                        error: error instanceof Error ? error.message : 'Upload failed'
                    }
                };
                saveSessions(updated);
                return updated;
            });
        }
    };

    const uploadChunked = async (
        tempId: string,
        file: File,
        partUrls: string[],
        chunkSize: number
    ) => {
        const uploadState = uploads[tempId];

        for (let i = 0; i < partUrls.length; i++) {
            if (uploadsPausedRef.current[tempId]) {
                setUploads(prev => ({ ...prev, [tempId]: { ...prev[tempId], status: 'paused' as UploadStatus } }));
                return;
            }

            if (uploadState.uploadedChunks.has(i)) {
                continue;
            }

            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, file.size);
            const chunk = file.slice(start, end);

            let retries = 3;
            while (retries > 0) {
                try {
                    const response = await fetch(partUrls[i], {
                        method: 'PUT',
                        body: chunk,
                    });

                    if (!response.ok) {
                        throw new Error(`Failed to upload chunk ${i + 1}`);
                    }

                    setUploads(prev => {
                        const newChunks = new Set(prev[tempId].uploadedChunks);
                        newChunks.add(i);
                        const uploadedBytes = Array.from(newChunks).reduce((sum, idx) => {
                            const chunkStart = idx * chunkSize;
                            const chunkEnd = Math.min(chunkStart + chunkSize, file.size);
                            return sum + (chunkEnd - chunkStart);
                        }, 0);

                        const updated = {
                            ...prev,
                            [tempId]: {
                                ...prev[tempId],
                                uploadedChunks: newChunks,
                                uploadedBytes,
                                progress: (uploadedBytes / file.size) * 100,
                            }
                        };
                        saveSessions(updated);
                        return updated;
                    });

                    break;
                } catch (error) {
                    retries--;
                    if (retries === 0) throw error;
                    await new Promise(resolve => setTimeout(resolve, 1000 * (4 - retries)));
                }
            }
        }
    };

    const uploadDirect = async (tempId: string, file: File, uploadUrl: string) => {
        return new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    setUploads(prev => {
                        const updated = {
                            ...prev,
                            [tempId]: {
                                ...prev[tempId],
                                progress: (e.loaded / e.total) * 100,
                                uploadedBytes: e.loaded,
                            }
                        };
                        saveSessions(updated);
                        return updated;
                    });
                }
            });

            xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve();
                } else {
                    reject(new Error(`Upload failed with status ${xhr.status}`));
                }
            };
            xhr.onerror = () => reject(new Error('Upload failed'));

            xhr.open('PUT', uploadUrl);
            xhr.setRequestHeader('Content-Type', file.type);
            xhr.send(file);
        });
    };

    const pollStatus = async (uploadId: string, tempId: string) => {
        const interval = setInterval(async () => {
            try {
                const response = await fetch(`${API_URL}/api/v1/videos/${uploadId}`);
                if (!response.ok) return;

                const data = await response.json() as { status: string };

                if (data.status === 'ready') {
                    setUploads(prev => {
                        const updated = { ...prev, [tempId]: { ...prev[tempId], status: 'complete' as UploadStatus } };
                        saveSessions(updated);
                        return updated;
                    });
                    clearInterval(interval);
                    localStorage.removeItem(`streamforge_upload_${tempId}`);
                } else if (data.status === 'failed') {
                    setUploads(prev => {
                        const updated = {
                            ...prev,
                            [tempId]: { ...prev[tempId], status: 'error' as UploadStatus, error: 'Processing failed' }
                        };
                        saveSessions(updated);
                        return updated;
                    });
                    clearInterval(interval);
                }
            } catch (error) {
                console.error('Status poll error:', error);
            }
        }, 3000);
    };

    const pauseUpload = (tempId: string) => {
        uploadsPausedRef.current[tempId] = true;
        setUploads(prev => {
            const updated = { ...prev, [tempId]: { ...prev[tempId], status: 'paused' as UploadStatus } };
            saveSessions(updated);
            return updated;
        });
    };

    const resumeUpload = async (tempId: string) => {
        uploadsPausedRef.current[tempId] = false;
        const upload = uploads[tempId];

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'video/*';
        input.onchange = (e: Event) => {
            const target = e.target as HTMLInputElement;
            const file = target.files?.[0];
            if (file && file.name === upload.filename) {
                uploadFile(file, tempId);
            }
        };
        input.click();
    };

    const cancelUpload = (tempId: string) => {
        uploadsPausedRef.current[tempId] = true;
        setUploads(prev => {
            const { [tempId]: removed, ...rest } = prev;
            saveSessions(rest);
            return rest;
        });
        delete uploadSessionsRef.current[tempId];
    };

    return (
        <div className="space-y-4">
            <div
                className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary transition-colors"
                onClick={() => fileInputRef.current?.click()}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/*"
                    multiple
                    onChange={handleFileSelect}
                    className="hidden"
                />
                <svg
                    className="mx-auto h-12 w-12 text-muted-foreground"
                    stroke="currentColor"
                    fill="none"
                    viewBox="0 0 48 48"
                >
                    <path
                        d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
                <p className="mt-2 text-sm text-muted-foreground">
                    Click to upload or drag and drop
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                    Video files only • Resumable uploads for files over 100MB
                </p>
            </div>

            {Object.entries(uploads).map(([id, upload]) => (
                <div key={id} className="border border-border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{upload.filename}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                                {(upload.uploadedBytes / 1024 / 1024).toFixed(1)} MB / {(upload.totalBytes / 1024 / 1024).toFixed(1)} MB
                            </p>
                        </div>
                        <div className="flex gap-2 ml-4">
                            {upload.status === 'uploading' && (
                                <button
                                    onClick={() => pauseUpload(id)}
                                    className="text-xs px-2 py-1 hover:bg-secondary rounded"
                                >
                                    Pause
                                </button>
                            )}
                            {upload.status === 'paused' && (
                                <button
                                    onClick={() => resumeUpload(id)}
                                    className="text-xs px-2 py-1 bg-primary text-primary-foreground hover:opacity-90 rounded"
                                >
                                    Resume
                                </button>
                            )}
                            {(upload.status === 'uploading' || upload.status === 'paused') && (
                                <button
                                    onClick={() => cancelUpload(id)}
                                    className="text-xs px-2 py-1 text-destructive hover:bg-destructive/10 rounded"
                                >
                                    Cancel
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="w-full bg-secondary rounded-full h-2 mb-2">
                        <div
                            className={`h-2 rounded-full transition-all ${upload.status === 'error' ? 'bg-destructive' :
                                    upload.status === 'paused' ? 'bg-muted-foreground' :
                                        'bg-primary'
                                }`}
                            style={{ width: `${upload.progress}%` }}
                        />
                    </div>

                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="capitalize">{upload.status}</span>
                        <span>{Math.round(upload.progress)}%</span>
                    </div>

                    {upload.error && (
                        <p className="text-xs text-destructive mt-2">{upload.error}</p>
                    )}
                </div>
            ))}
        </div>
    );
}
