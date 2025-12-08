"use client";

import React, { useEffect, useRef, useState } from "react";
import { MSEController, VideoManifest } from "@/app/lib/mse-controller";
import { ThumbnailStore } from "@/app/lib/thumbnail-store";
import { useVideoPlayer } from "@/app/contexts/video-player-context";
import { VideoQuality } from "@/app/lib/constants";

interface SmartVideoProps {
  manifest: VideoManifest;
  poster?: string;
  baseUrl: string;
}

export function SmartVideo({ manifest, poster, baseUrl }: SmartVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controllerRef = useRef<MSEController | null>(null);
  const thumbnailStoreRef = useRef<ThumbnailStore | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  const { state, actions } = useVideoPlayer();

  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [thumbnailPosition, setThumbnailPosition] = useState({ x: 0, time: 0 });
  const [showThumbnail, setShowThumbnail] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);

  useEffect(() => {
    if (videoRef.current && manifest) {
      controllerRef.current = new MSEController(
        videoRef.current,
        manifest,
        baseUrl
      );

      if (manifest.thumbnails) {
        thumbnailStoreRef.current = new ThumbnailStore(
          baseUrl,
          manifest.thumbnails.pattern,
          manifest.thumbnails.interval,
          manifest.videoId
        );
      }

      actions.setDuration(manifest.duration);
      actions.setAvailableQualities(
        controllerRef.current.getAvailableQualities()
      );
      actions.setQuality(controllerRef.current.getCurrentQuality());
    }

    return () => {
      controllerRef.current?.destroy();
      actions.reset();
    };
  }, [manifest, baseUrl, actions]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => actions.play();
    const handlePause = () => actions.pause();
    const handleTimeUpdate = () => {
      actions.setTime(video.currentTime);
      updateBufferedRanges();
    };
    const handleVolumeChange = () => {
      actions.setVolume(video.volume);
      if (video.muted) actions.toggleMute();
    };
    const handleWaiting = () => actions.setBuffering(true);
    const handleCanPlay = () => actions.setBuffering(false);

    video.addEventListener("play", handlePlay);
    video.addEventListener("pause", handlePause);
    video.addEventListener("timeupdate", handleTimeUpdate);
    video.addEventListener("volumechange", handleVolumeChange);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("canplay", handleCanPlay);

    return () => {
      video.removeEventListener("play", handlePlay);
      video.removeEventListener("pause", handlePause);
      video.removeEventListener("timeupdate", handleTimeUpdate);
      video.removeEventListener("volumechange", handleVolumeChange);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("canplay", handleCanPlay);
    };
  }, [actions]);

  const updateBufferedRanges = () => {
    const video = videoRef.current;
    if (!video) return;
    actions.setBufferedRanges(video.buffered);
  };

  const togglePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;

    if (state.isPlaying) {
      video.pause();
    } else {
      video.play();
    }
  };

  const handleSeek = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const time = percentage * state.duration;

    if (videoRef.current) {
      videoRef.current.currentTime = time;
      controllerRef.current?.seek(time);
    }
  };

  const handleProgressHover = async (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const time = percentage * state.duration;

    setThumbnailPosition({ x, time });
    setShowThumbnail(true);

    if (thumbnailStoreRef.current) {
      const url = await thumbnailStoreRef.current.getThumbnailForTime(time);
      setThumbnailUrl(url);
    }
  };

  const handleProgressLeave = () => {
    setShowThumbnail(false);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVolume = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.volume = newVolume;
      videoRef.current.muted = newVolume === 0;
    }
  };

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted;
    }
  };

  const toggleFullscreen = () => {
    const container = videoRef.current?.parentElement;
    if (!container) return;

    if (document.fullscreenElement) {
      document.exitFullscreen();
      actions.setFullscreen(false);
    } else {
      container.requestFullscreen();
      actions.setFullscreen(true);
    }
  };

  const switchQuality = async (quality: VideoQuality) => {
    if (controllerRef.current) {
      await controllerRef.current.switchQuality(quality);
      actions.setQuality(quality);
      setShowQualityMenu(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const bufferedRanges: { start: number; end: number }[] = [];
  if (state.bufferedRanges) {
    for (let i = 0; i < state.bufferedRanges.length; i++) {
      bufferedRanges.push({
        start: state.bufferedRanges.start(i),
        end: state.bufferedRanges.end(i),
      });
    }
  }

  return (
    <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden shadow-2xl group">
      <video
        ref={videoRef}
        poster={poster}
        className="w-full h-full object-contain"
      />

      {state.isBuffering && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}

      <div
        className="absolute bottom-0 left-0 right-0 bg-linear-to-t from-black/90 to-transparent p-4 transition-opacity"
        style={{ opacity: state.showControls ? 1 : 0 }}
        onPointerEnter={actions.showControls}
        onPointerLeave={actions.hideControls}
      >
        <div
          ref={progressRef}
          className="relative h-2 bg-white/20 rounded-full cursor-pointer mb-4"
          onPointerDown={handleSeek}
          onPointerMove={handleProgressHover}
          onPointerLeave={handleProgressLeave}
        >
          {bufferedRanges.map((range, i) => (
            <div
              key={i}
              className="absolute h-full bg-white/40 rounded-full"
              style={{
                left: `${(range.start / state.duration) * 100}%`,
                width: `${((range.end - range.start) / state.duration) * 100}%`,
              }}
            />
          ))}
          <div
            className="absolute h-full bg-primary rounded-full"
            style={{ width: `${(state.currentTime / state.duration) * 100}%` }}
          />
          {showThumbnail && thumbnailUrl && (
            <div
              className="absolute bottom-full mb-2 transform -translate-x-1/2 pointer-events-none"
              style={{ left: thumbnailPosition.x }}
            >
              <div className="bg-black/90 p-1 rounded">
                <img
                  src={thumbnailUrl}
                  alt="Preview"
                  className="w-32 h-18 object-cover rounded"
                />
                <div className="text-xs text-white text-center mt-1">
                  {formatTime(thumbnailPosition.time)}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between text-white">
          <div className="flex items-center gap-4">
            <button
              onClick={togglePlayPause}
              className="hover:text-primary transition-colors"
              aria-label={state.isPlaying ? "Pause" : "Play"}
            >
              {state.isPlaying ? (
                <svg
                  className="w-6 h-6"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
              ) : (
                <svg
                  className="w-6 h-6"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </button>

            <div className="text-sm">
              {formatTime(state.currentTime)} / {formatTime(state.duration)}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative">
              <button
                onClick={() => setShowQualityMenu(!showQualityMenu)}
                className="text-xs px-2 py-1 bg-white/10 hover:bg-white/20 rounded transition-colors"
              >
                {state.currentQuality}
              </button>
              {showQualityMenu && (
                <div className="absolute bottom-full mb-2 right-0 bg-black/90 rounded overflow-hidden">
                  {state.availableQualities.map((quality) => (
                    <button
                      key={quality}
                      onClick={() => switchQuality(quality as VideoQuality)}
                      className={`block w-full text-xs px-4 py-2 text-left hover:bg-white/20 transition-colors ${
                        quality === state.currentQuality
                          ? "bg-primary text-white"
                          : ""
                      }`}
                    >
                      {quality}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={toggleMute}
                className="hover:text-primary transition-colors"
                aria-label="Toggle mute"
              >
                {state.isMuted || state.volume === 0 ? (
                  <svg
                    className="w-5 h-5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM12.293 7.293a1 1 0 011.414 0L15 8.586l1.293-1.293a1 1 0 111.414 1.414L16.414 10l1.293 1.293a1 1 0 01-1.414 1.414L15 11.414l-1.293 1.293a1 1 0 01-1.414-1.414L13.586 10l-1.293-1.293a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  <svg
                    className="w-5 h-5"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={state.volume}
                onChange={handleVolumeChange}
                className="w-20 accent-primary"
                aria-label="Volume"
              />
            </div>

            <button
              onClick={toggleFullscreen}
              className="hover:text-primary transition-colors"
              aria-label="Toggle fullscreen"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l2.293 2.293a1 1 0 11-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 010-2h4a1 1 0 011 1v4a1 1 0 01-2 0V6.414l-2.293 2.293a1 1 0 11-1.414-1.414L13.586 5H12zm-9 7a1 1 0 012 0v1.586l2.293-2.293a1 1 0 111.414 1.414L6.414 15H8a1 1 0 010 2H4a1 1 0 01-1-1v-4zm13-1a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 010-2h1.586l-2.293-2.293a1 1 0 111.414-1.414L15 13.586V12a1 1 0 011-1z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
