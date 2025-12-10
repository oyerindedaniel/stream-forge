"use client";

import { useState, useRef } from "react";
import { API_URL } from "@/app/lib/constants";
import { UPLOAD_CHUNK_SIZE } from "@/app/lib/constants";
import { createSHA256 } from "hash-wasm";
import { STORAGE_KEY } from "@/app/lib/constants";

export function Uploader() {
  const [uploadSessions, setUploadSessions] = useState<
    Record<string, UploadSession>
  >(() => {
    if (typeof window === "undefined") return {};
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return {};

    try {
      const sessions = JSON.parse(saved) as Record<string, SavedSession>;
      const restored: Record<string, UploadSession> = {};
      const now = Date.now();

      Object.values(sessions).forEach((session) => {
        if (session.status === "uploading" || session.status === "paused") {
          if (session.urlsExpiresAt) {
            const expiresAt = new Date(session.urlsExpiresAt).getTime();
            if (now >= expiresAt) return;
          }

          restored[session.uploadId] = {
            ...session,
            status: "paused",
            uploadedChunks: new Set(session.uploadedChunks || []),
          };
        }
      });

      return restored;
    } catch {
      return {};
    }
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadSessionsRef =
    useRef<Record<string, UploadSession>>(uploadSessions);

  const uploadsPausedRef = useRef<Record<string, boolean>>(
    Object.fromEntries(
      Object.entries(uploadSessions)
        .filter(([_, session]) => session.status === "paused")
        .map(([id, _]) => [id, true])
    )
  );
  const abortControllersRef = useRef<Record<string, AbortController>>({});

  const saveSessions = (currentSessions: Record<string, UploadSession>) => {
    const toSave = Object.fromEntries(
      Object.entries(currentSessions).map(([id, session]) => [
        id,
        {
          ...session,
          uploadedChunks: Array.from(session.uploadedChunks),
        },
      ])
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      uploadFile(file);
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const uploadFile = async (file: File, resumeId?: string) => {
    const tempId = resumeId || crypto.randomUUID();

    abortControllersRef.current[tempId] = new AbortController();

    const initialSession: UploadSession = {
      uploadId: tempId,
      filename: file.name,
      progress: 0,
      uploadedBytes: 0,
      totalBytes: file.size,
      status: "uploading",
      uploadedChunks: new Set(),
    };

    uploadSessionsRef.current[tempId] = initialSession;

    setUploadSessions((prev) => {
      const updated = { ...prev, [tempId]: initialSession };
      saveSessions(updated);
      return updated;
    });

    try {
      const initResponse = await fetch(`${API_URL}/api/v1/uploads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          size: file.size,
          metadata: { title: file.name },
          checksum: await calculateChecksum(file).catch((e) => {
            console.warn("Checksum calculation failed:", e);
            return undefined;
          }),
        }),
      });

      if (!initResponse.ok) {
        throw new Error("Failed to initialize upload");
      }

      const initData = (await initResponse.json()) as UploadAPIResponse;

      if (initData.type === "multipart") {
        const totalChunks = initData.partUrls.length;

        const updatedSession: UploadSession = {
          ...uploadSessionsRef.current[tempId],
          uploadId: initData.uploadId,
          type: "multipart",
          multipartUploadId: initData.multipartUploadId,
          partUrls: initData.partUrls,
          totalChunks,
          uploadedParts: null,
          urlsExpiresAt: initData.expiresAt,
        };

        uploadSessionsRef.current[tempId] = updatedSession;

        setUploadSessions((prev) => {
          const updated = { ...prev, [tempId]: updatedSession };
          saveSessions(updated);
          return updated;
        });

        await uploadChunked(tempId, file, initData.partUrls, initData.partSize);
      } else {
        const updatedSession: UploadSession = {
          ...uploadSessionsRef.current[tempId],
          uploadId: initData.uploadId,
          type: "single",
          uploadUrl: initData.uploadUrl,
          totalChunks: 1,
        };

        uploadSessionsRef.current[tempId] = updatedSession;

        setUploadSessions((prev) => {
          const updated = { ...prev, [tempId]: updatedSession };
          saveSessions(updated);
          return updated;
        });

        await uploadDirect(tempId, file, initData.uploadUrl);
      }

      const session = uploadSessionsRef.current[tempId];
      const completeBody: {
        multipartUploadId?: string;
        parts?: UploadedParts;
      } = {};

      if (
        session.type === "multipart" &&
        session.multipartUploadId &&
        session.uploadedParts
      ) {
        completeBody.multipartUploadId = session.multipartUploadId;
        completeBody.parts = session.uploadedParts;
      }

      const completeResponse = await fetch(
        `${API_URL}/api/v1/uploads/${session.uploadId}/complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(completeBody),
        }
      );

      if (!completeResponse.ok) {
        throw new Error("Failed to complete upload");
      }

      const completedSession: UploadSession = {
        ...uploadSessionsRef.current[tempId],
        status: "complete",
        progress: 100,
      };

      uploadSessionsRef.current[tempId] = completedSession;

      setUploadSessions((prev) => {
        const updated = { ...prev, [tempId]: completedSession };
        saveSessions(updated);
        return updated;
      });

      delete uploadSessionsRef.current[tempId];
      delete uploadsPausedRef.current[tempId];
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.log("Upload cancelled by user");
        return;
      }

      console.error("Upload error:", error);

      const errorSession: UploadSession = {
        ...uploadSessionsRef.current[tempId],
        status: "error",
        error: error instanceof Error ? error.message : "Upload failed",
      };

      uploadSessionsRef.current[tempId] = errorSession;

      setUploadSessions((prev) => {
        const updated = { ...prev, [tempId]: errorSession };
        saveSessions(updated);
        return updated;
      });
    } finally {
      delete abortControllersRef.current[tempId];
    }
  };

  const uploadChunked = async (
    tempId: string,
    file: File,
    partUrls: string[],
    chunkSize: number
  ) => {
    const uploadedParts: UploadedParts = [];

    const session = uploadSessionsRef.current[tempId];
    if (!session.type || session.type !== "multipart") {
      console.error(`Session type is "${session.type}", expected "multipart"`);
      return;
    }

    const abortController = abortControllersRef.current[tempId];
    if (!abortController) {
      throw new Error("Upload aborted before starting");
    }

    for (let i = 0; i < partUrls.length; i++) {
      if (uploadsPausedRef.current[tempId]) {
        return;
      }

      if (uploadSessionsRef.current[tempId]?.uploadedChunks.has(i)) {
        continue;
      }

      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.size);
      const chunk = file.slice(start, end);

      let retries = 3;
      while (retries > 0) {
        try {
          const response = await fetch(partUrls[i], {
            method: "PUT",
            body: chunk,
            signal: abortController.signal,
          });

          if (!response.ok) {
            throw new Error(`Failed to upload chunk ${i + 1}`);
          }

          const etag = response.headers.get("ETag");
          if (!etag) {
            throw new Error(`No ETag returned for part ${i + 1}`);
          }

          uploadedParts.push({
            PartNumber: i + 1,
            ETag: etag.replace(/"/g, ""),
          });

          setUploadSessions((prev) => {
            const newChunks = new Set(prev[tempId].uploadedChunks);
            newChunks.add(i);
            const uploadedBytes = Array.from(newChunks).reduce((sum, idx) => {
              const chunkStart = idx * chunkSize;
              const chunkEnd = Math.min(chunkStart + chunkSize, file.size);
              return sum + (chunkEnd - chunkStart);
            }, 0);

            const updatedSession: UploadSession = {
              ...prev[tempId],
              uploadedChunks: newChunks,
              uploadedBytes,
              progress: (uploadedBytes / file.size) * 100,
            };

            uploadSessionsRef.current[tempId] = updatedSession;

            const updated = { ...prev, [tempId]: updatedSession };
            saveSessions(updated);
            return updated;
          });

          break;
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") {
            throw error;
          }

          retries--;
          if (retries === 0) throw error;
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * (4 - retries))
          );
        }
      }
    }

    uploadSessionsRef.current[tempId].uploadedParts = uploadedParts;
  };

  const uploadDirect = async (
    tempId: string,
    file: File,
    uploadUrl: string
  ) => {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable) {
          setUploadSessions((prev) => {
            const updatedSession: UploadSession = {
              ...prev[tempId],
              progress: (e.loaded / e.total) * 100,
              uploadedBytes: e.loaded,
            };

            uploadSessionsRef.current[tempId] = updatedSession;

            const updated = { ...prev, [tempId]: updatedSession };
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
      xhr.onerror = () => reject(new Error("Upload failed"));

      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.send(file);
    });
  };

  const pauseUpload = (tempId: string) => {
    uploadsPausedRef.current[tempId] = true;

    const pausedSession: UploadSession = {
      ...uploadSessionsRef.current[tempId],
      status: "paused",
    };

    uploadSessionsRef.current[tempId] = pausedSession;

    setUploadSessions((prev) => {
      const updated = { ...prev, [tempId]: pausedSession };
      saveSessions(updated);
      return updated;
    });
  };

  const resumeUpload = async (tempId: string) => {
    uploadsPausedRef.current[tempId] = false;
    abortControllersRef.current[tempId] = new AbortController();
    const session = uploadSessions[tempId];

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*";
    input.onchange = async (e: Event) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (!file || file.name !== session.filename) {
        return;
      }

      const uploadingSession: UploadSession = {
        ...uploadSessionsRef.current[tempId],
        status: "uploading",
      };

      uploadSessionsRef.current[tempId] = uploadingSession;

      setUploadSessions((prev) => ({
        ...prev,
        [tempId]: uploadingSession,
      }));

      try {
        const sessionRef = uploadSessionsRef.current[tempId];
        if (!sessionRef) {
          throw new Error("Upload session not found");
        }

        if (sessionRef.type === "multipart" && sessionRef.multipartUploadId) {
          const now = new Date().getTime();
          const expiresAt = sessionRef.urlsExpiresAt
            ? new Date(sessionRef.urlsExpiresAt).getTime()
            : 0;
          const urlsExpired = !sessionRef.urlsExpiresAt || now >= expiresAt;

          let partUrls = sessionRef.partUrls || [];
          let partSize = UPLOAD_CHUNK_SIZE;

          if (urlsExpired) {
            const refreshResponse = await fetch(
              `${API_URL}/api/v1/uploads/${sessionRef.uploadId}/refresh-urls`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  multipartUploadId: sessionRef.multipartUploadId,
                }),
              }
            );

            if (!refreshResponse.ok) {
              throw new Error("Failed to refresh upload URLs");
            }

            const refreshData = await refreshResponse.json();
            partUrls = refreshData.partUrls;
            partSize = refreshData.partSize;

            const refreshedSession: UploadSession = {
              ...uploadSessionsRef.current[tempId],
              partUrls,
              urlsExpiresAt: refreshData.expiresAt,
            };

            uploadSessionsRef.current[tempId] = refreshedSession;

            setUploadSessions((prev) => {
              const updated = { ...prev, [tempId]: refreshedSession };
              saveSessions(updated);
              return updated;
            });
          }

          await uploadChunked(tempId, file, partUrls, partSize);
        } else {
          // For direct upload, we re-initialize
          uploadFile(file, tempId);
          return;
        }

        const completeBody: {
          multipartUploadId?: string;
          parts?: UploadedParts;
        } = {};

        const finalSession = uploadSessionsRef.current[tempId];
        if (finalSession.multipartUploadId && finalSession.uploadedParts) {
          completeBody.multipartUploadId = finalSession.multipartUploadId;
          completeBody.parts = finalSession.uploadedParts;
        }

        const completeResponse = await fetch(
          `${API_URL}/api/v1/uploads/${finalSession.uploadId}/complete`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(completeBody),
          }
        );

        if (!completeResponse.ok) {
          throw new Error("Failed to complete upload");
        }

        const processingSession: UploadSession = {
          ...uploadSessionsRef.current[tempId],
          status: "complete",
          progress: 100,
        };

        uploadSessionsRef.current[tempId] = processingSession;

        setUploadSessions((prev) => ({
          ...prev,
          [tempId]: processingSession,
        }));
      } catch (error) {
        console.error("Resume error:", error);

        const errorSession: UploadSession = {
          ...uploadSessionsRef.current[tempId],
          status: "error",
          error: error instanceof Error ? error.message : "Resume failed",
        };

        uploadSessionsRef.current[tempId] = errorSession;

        setUploadSessions((prev) => ({
          ...prev,
          [tempId]: errorSession,
        }));
      }
    };
    input.click();
  };

  const cancelUpload = async (tempId: string) => {
    const session = uploadSessionsRef.current[tempId];
    const abortController = abortControllersRef.current[tempId];

    if (abortController) {
      abortController.abort();
      delete abortControllersRef.current[tempId];
    }

    if (session?.type === "multipart" && session.multipartUploadId) {
      try {
        await fetch(`${API_URL}/api/v1/uploads/${session.uploadId}/abort`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            multipartUploadId: session.multipartUploadId,
          }),
        });
      } catch (error) {
        console.error("Failed to abort S3 upload:", error);
      }
    }

    setUploadSessions((prev) => {
      const { [tempId]: removed, ...rest } = prev;
      saveSessions(rest);
      return rest;
    });

    delete uploadSessionsRef.current[tempId];
    delete uploadsPausedRef.current[tempId];
  };

  return (
    <div className="space-y-4 p-6">
      <div
        className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-blue-500 transition-colors"
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
          className="mx-auto h-12 w-12 text-gray-400"
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
        <p className="mt-2 text-sm text-gray-600">
          Click to upload or drag and drop
        </p>
        <p className="text-xs text-gray-500 mt-1">
          Video files only • Resumable uploads for files over 100MB
        </p>
      </div>

      {Object.entries(uploadSessions).map(([id, session]) => (
        <div key={id} className="border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{session.filename}</p>
              <p className="text-xs text-gray-500 mt-1">
                {(session.uploadedBytes / 1024 / 1024).toFixed(1)} MB /{" "}
                {(session.totalBytes / 1024 / 1024).toFixed(1)} MB
              </p>
            </div>
            <div className="flex gap-2 ml-4">
              {session.status === "uploading" && (
                <button
                  onClick={() => pauseUpload(id)}
                  className="text-xs px-2 py-1 hover:bg-gray-100 rounded"
                >
                  Pause
                </button>
              )}
              {session.status === "paused" && (
                <button
                  onClick={() => resumeUpload(id)}
                  className="text-xs px-2 py-1 bg-blue-500 text-white hover:bg-blue-600 rounded"
                >
                  Resume
                </button>
              )}
              {(session.status === "uploading" ||
                session.status === "paused") && (
                <button
                  onClick={() => cancelUpload(id)}
                  className="text-xs px-2 py-1 text-red-600 hover:bg-red-50 rounded"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>

          <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
            <div
              className={`h-2 rounded-full transition-all ${
                session.status === "error"
                  ? "bg-red-500"
                  : session.status === "paused"
                  ? "bg-gray-500"
                  : "bg-blue-500"
              }`}
              style={{ width: `${session.progress}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-xs text-gray-500">
            <span className="capitalize">{session.status}</span>
            <span>{Math.round(session.progress)}%</span>
          </div>

          {session.error && (
            <p className="text-xs text-red-600 mt-2">{session.error}</p>
          )}
        </div>
      ))}
    </div>
  );
}

async function calculateChecksum(file: File): Promise<string> {
  const hasher = await createSHA256();
  hasher.init();
  const chunkSize = UPLOAD_CHUNK_SIZE;
  const totalChunks = Math.ceil(file.size / chunkSize);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = file.slice(start, end);
    const buffer = await chunk.arrayBuffer();

    hasher.update(new Uint8Array(buffer));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const digest = hasher.digest("binary");
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

type UploadStatus = "uploading" | "complete" | "error" | "paused";

type UploadedPart = {
  PartNumber: number;
  ETag: string;
};

type UploadedParts = UploadedPart[];

interface UploadSession {
  // Progress data (for UI)
  uploadId: string;
  filename: string;
  progress: number;
  uploadedBytes: number;
  totalBytes: number;
  status: UploadStatus;
  error?: string;
  uploadedChunks: Set<number>;

  // Session data (for resuming)
  type?: "multipart" | "single";
  multipartUploadId?: string;
  partUrls?: string[];
  uploadUrl?: string;
  totalChunks?: number;
  uploadedParts?: UploadedParts | null;
  urlsExpiresAt?: string;
}

interface SavedSession extends Omit<UploadSession, "uploadedChunks"> {
  uploadedChunks: number[];
}

type SingleUploadResponse = {
  type: "single";
  uploadId: string;
  uploadUrl: string;
  expiresAt: string;
};

type MultipartUploadResponse = {
  type: "multipart";
  uploadId: string;
  multipartUploadId: string;
  numParts: number;
  partUrls: string[];
  partSize: number;
  expiresAt: string;
};

type UploadAPIResponse = SingleUploadResponse | MultipartUploadResponse;
