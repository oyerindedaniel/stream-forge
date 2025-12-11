"use client";

import Link from "next/link";
import { API_URL } from "@/app/lib/constants";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LoaderIcon } from "@/icons/loader";
import { useState } from "react";

interface Video {
  id: string;
  title: string;
  status:
    | "ready"
    | "pending_upload"
    | "uploading"
    | "processing"
    | "failed"
    | "cancelled"
    | "deleted";
  duration?: number;
  width?: number;
  height?: number;
  createdAt: string;
}

async function fetchVideos(): Promise<{ videos: Video[] }> {
  const res = await fetch(`${API_URL}/api/v1/videos`);
  if (!res.ok) throw new Error("Failed to fetch videos");
  return res.json();
}

async function deleteVideo(videoId: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1/videos/${videoId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete video");
}

export function VideoList() {
  const queryClient = useQueryClient();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ["videos"],
    queryFn: fetchVideos,
    refetchInterval: (query) => {
      if (query.state.status === "pending" || query.state.status === "error") {
        return false;
      }
      return 7000;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteVideo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["videos"] });
      setDeletingId(null);
    },
    onError: (error) => {
      console.error("Failed to delete video:", error);
      setDeletingId(null);
    },
  });

  const handleDelete = (e: React.MouseEvent, videoId: string) => {
    e.preventDefault();

    if (confirm("Are you sure you want to delete this video?")) {
      setDeletingId(videoId);
      deleteMutation.mutate(videoId);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Your Videos</h2>
        {/* {isRefetching && (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <LoaderIcon fill="white" />
            Updating...
          </div>
        )} */}
      </div>

      {isPending ? (
        <div className="flex justify-center items-center p-10">
          <LoaderIcon fill="white" />
        </div>
      ) : !data || data.videos.length === 0 ? (
        <div className="text-center p-10 text-muted-foreground">
          No videos yet. Upload one to get started!
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {data.videos.map((video) => (
            <div key={video.id} className="relative group">
              <Link
                href={`/video/${video.id}`}
                className="block p-4 rounded-3xl border-2 hover:border-primary hover:shadow-lg transition-all"
              >
                <div className="aspect-video bg-secondary rounded mb-2 flex items-center justify-center">
                  {video.status === "ready" ? (
                    <svg
                      className="w-12 h-12 text-primary"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  ) : (
                    <div className="text-sm text-muted-foreground capitalize font-mono">
                      {video.status.replace("_", " ")}
                    </div>
                  )}
                </div>
                <h3 className="font-semibold truncate">{video.title}</h3>
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span
                    className={`capitalize font-mono ${
                      video.status === "ready"
                        ? "text-green-500"
                        : video.status === "failed"
                        ? "text-red-500"
                        : "text-yellow-500"
                    }`}
                  >
                    {video.status.replace("_", " ")}
                  </span>
                  {video.duration && (
                    <span>
                      {Math.floor(video.duration / 60)}:
                      {String(Math.floor(video.duration % 60)).padStart(2, "0")}
                    </span>
                  )}
                </div>
              </Link>

              <button
                onClick={(e) => handleDelete(e, video.id)}
                disabled={deletingId === video.id}
                className="absolute top-2 right-2 cursor-pointer p-2 bg-red-500/90 text-white rounded-full opacity-0 group-hover:opacity-100 hover:bg-red-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                title="Delete video"
              >
                {deletingId === video.id ? (
                  <LoaderIcon size={20} fill="white" />
                ) : (
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
