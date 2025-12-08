'use client';
import React, { createContext, useContext, useReducer, ReactNode } from 'react';

export interface VideoPlayerState {
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    isMuted: boolean;
    currentQuality: string;
    availableQualities: string[];
    bufferedRanges: TimeRanges | null;
    isBuffering: boolean;
    playbackRate: number;
    showControls: boolean;
    isFullscreen: boolean;
    error: string | null;
}

type VideoPlayerAction =
    | { type: 'PLAY' }
    | { type: 'PAUSE' }
    | { type: 'TOGGLE_PLAY' }
    | { type: 'SET_TIME'; payload: number }
    | { type: 'SET_DURATION'; payload: number }
    | { type: 'SET_VOLUME'; payload: number }
    | { type: 'TOGGLE_MUTE' }
    | { type: 'SET_QUALITY'; payload: string }
    | { type: 'SET_AVAILABLE_QUALITIES'; payload: string[] }
    | { type: 'SET_BUFFERED_RANGES'; payload: TimeRanges | null }
    | { type: 'SET_BUFFERING'; payload: boolean }
    | { type: 'SET_PLAYBACK_RATE'; payload: number }
    | { type: 'SHOW_CONTROLS' }
    | { type: 'HIDE_CONTROLS' }
    | { type: 'SET_FULLSCREEN'; payload: boolean }
    | { type: 'SET_ERROR'; payload: string | null }
    | { type: 'RESET' };

const initialState: VideoPlayerState = {
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    volume: 1,
    isMuted: false,
    currentQuality: '720p',
    availableQualities: [],
    bufferedRanges: null,
    isBuffering: false,
    playbackRate: 1,
    showControls: true,
    isFullscreen: false,
    error: null,
};

function videoPlayerReducer(
    state: VideoPlayerState,
    action: VideoPlayerAction
): VideoPlayerState {
    switch (action.type) {
        case 'PLAY':
            return { ...state, isPlaying: true };

        case 'PAUSE':
            return { ...state, isPlaying: false };

        case 'TOGGLE_PLAY':
            return { ...state, isPlaying: !state.isPlaying };

        case 'SET_TIME':
            return { ...state, currentTime: action.payload };

        case 'SET_DURATION':
            return { ...state, duration: action.payload };

        case 'SET_VOLUME':
            return {
                ...state,
                volume: Math.max(0, Math.min(1, action.payload)),
                isMuted: action.payload === 0
            };

        case 'TOGGLE_MUTE':
            return { ...state, isMuted: !state.isMuted };

        case 'SET_QUALITY':
            return { ...state, currentQuality: action.payload };

        case 'SET_AVAILABLE_QUALITIES':
            return { ...state, availableQualities: action.payload };

        case 'SET_BUFFERED_RANGES':
            return { ...state, bufferedRanges: action.payload };

        case 'SET_BUFFERING':
            return { ...state, isBuffering: action.payload };

        case 'SET_PLAYBACK_RATE':
            return { ...state, playbackRate: action.payload };

        case 'SHOW_CONTROLS':
            return { ...state, showControls: true };

        case 'HIDE_CONTROLS':
            return { ...state, showControls: false };

        case 'SET_FULLSCREEN':
            return { ...state, isFullscreen: action.payload };

        case 'SET_ERROR':
            return { ...state, error: action.payload, isPlaying: false };

        case 'RESET':
            return initialState;

        default:
            return state;
    }
}

interface VideoPlayerContextType {
    state: VideoPlayerState;
    dispatch: React.Dispatch<VideoPlayerAction>;
    actions: {
        play: () => void;
        pause: () => void;
        togglePlay: () => void;
        setTime: (time: number) => void;
        setDuration: (duration: number) => void;
        setVolume: (volume: number) => void;
        toggleMute: () => void;
        setQuality: (quality: string) => void;
        setAvailableQualities: (qualities: string[]) => void;
        setBufferedRanges: (ranges: TimeRanges | null) => void;
        setBuffering: (buffering: boolean) => void;
        setPlaybackRate: (rate: number) => void;
        showControls: () => void;
        hideControls: () => void;
        setFullscreen: (fullscreen: boolean) => void;
        setError: (error: string | null) => void;
        reset: () => void;
    };
}

const VideoPlayerContext = createContext<VideoPlayerContextType | null>(null);

export function VideoPlayerProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(videoPlayerReducer, initialState);

    const actions = {
        play: () => dispatch({ type: 'PLAY' }),
        pause: () => dispatch({ type: 'PAUSE' }),
        togglePlay: () => dispatch({ type: 'TOGGLE_PLAY' }),
        setTime: (time: number) => dispatch({ type: 'SET_TIME', payload: time }),
        setDuration: (duration: number) => dispatch({ type: 'SET_DURATION', payload: duration }),
        setVolume: (volume: number) => dispatch({ type: 'SET_VOLUME', payload: volume }),
        toggleMute: () => dispatch({ type: 'TOGGLE_MUTE' }),
        setQuality: (quality: string) => dispatch({ type: 'SET_QUALITY', payload: quality }),
        setAvailableQualities: (qualities: string[]) => dispatch({ type: 'SET_AVAILABLE_QUALITIES', payload: qualities }),
        setBufferedRanges: (ranges: TimeRanges | null) => dispatch({ type: 'SET_BUFFERED_RANGES', payload: ranges }),
        setBuffering: (buffering: boolean) => dispatch({ type: 'SET_BUFFERING', payload: buffering }),
        setPlaybackRate: (rate: number) => dispatch({ type: 'SET_PLAYBACK_RATE', payload: rate }),
        showControls: () => dispatch({ type: 'SHOW_CONTROLS' }),
        hideControls: () => dispatch({ type: 'HIDE_CONTROLS' }),
        setFullscreen: (fullscreen: boolean) => dispatch({ type: 'SET_FULLSCREEN', payload: fullscreen }),
        setError: (error: string | null) => dispatch({ type: 'SET_ERROR', payload: error }),
        reset: () => dispatch({ type: 'RESET' }),
    };

    return (
        <VideoPlayerContext.Provider value={{ state, dispatch, actions }}>
            {children}
        </VideoPlayerContext.Provider>
    );
}

export function useVideoPlayer() {
    const context = useContext(VideoPlayerContext);
    if (!context) {
        throw new Error('useVideoPlayer must be used within VideoPlayerProvider');
    }
    return context;
}
