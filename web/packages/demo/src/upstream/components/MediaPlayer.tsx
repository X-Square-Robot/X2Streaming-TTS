import {forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState} from "react";
import type {CSSProperties} from "react";
import {Pause, Play, Volume2, VolumeX} from "lucide-react";

import "./media.css";

export interface MediaPlayerProps {
  readonly src: string;
  readonly label: string;
  readonly autoPlay?: boolean;
  /**
   * Keep the native audio element and loading lifecycle, but let a parent
   * provide its own transport UI (for example, the PK timeline).
   */
  readonly showControls?: boolean;
  readonly onPlay?: () => void | Promise<void>;
  readonly onPlaybackStateChange?: (playing: boolean) => void;
  readonly onPositionChange?: (seconds: number) => void;
  readonly volume?: number;
  readonly className?: string;
}

export interface MediaPlayerHandle {
  play: () => Promise<void>;
  pause: () => void;
  seek: (seconds: number) => void;
  reset: () => void;
}

export function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

/** A small, keyboard-friendly audio control shared by generated clips and live samples. */
export const MediaPlayer = forwardRef<MediaPlayerHandle, MediaPlayerProps>(function MediaPlayer(
  {src, label, autoPlay = false, showControls = true, onPlay, onPlaybackStateChange, onPositionChange, volume, className},
  ref,
) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const frameRef = useRef<number | null>(null);
  const onPlayRef = useRef(onPlay);
  const onPlaybackStateChangeRef = useRef<MediaPlayerProps["onPlaybackStateChange"]>();
  const onPositionChangeRef = useRef(onPositionChange);
  const playGenerationRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  onPlayRef.current = onPlay;
  onPlaybackStateChangeRef.current = onPlaybackStateChange;
  onPositionChangeRef.current = onPositionChange;

  const reportPosition = useCallback((seconds: number) => {
    const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    setCurrent(safeSeconds);
    onPositionChangeRef.current?.(safeSeconds);
  }, []);

  const stopFrame = useCallback(() => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
  }, []);

  const syncFrame = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    reportPosition(audio.currentTime);
    if (!audio.paused && !audio.ended) frameRef.current = requestAnimationFrame(syncFrame);
    else frameRef.current = null;
  }, [reportPosition]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const generation = ++playGenerationRef.current;
    stopFrame();
    setCurrent(0);
    setDuration(0);
    setIsPlaying(false);
    setError(null);
    audio.pause();
    audio.currentTime = 0;
    reportPosition(0);
    audio.load();
    if (autoPlay) {
      void audio.play().catch(() => {
        if (playGenerationRef.current === generation) setError("自动播放被浏览器拦截，请点击播放。");
      });
    }
    return () => {
      ++playGenerationRef.current;
      audio.pause();
      stopFrame();
    };
  }, [src, autoPlay, stopFrame]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || volume === undefined) return;
    audio.volume = Math.min(1, Math.max(0, volume));
  }, [volume]);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setError(null);
    if (audio.paused) {
      void audio.play().catch(() => setError("音频无法播放，请检查文件或连接。"));
    } else {
      audio.pause();
    }
  };

  const seek = useCallback((nextValue: number) => {
    const audio = audioRef.current;
    const next = Math.min(duration || 0, Math.max(0, nextValue));
    if (audio) audio.currentTime = next;
    reportPosition(next);
  }, [duration, reportPosition]);

  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    setError(null);
    try {
      await audio.play();
    } catch (cause) {
      const message = `音频无法播放，请检查文件或连接。`;
      setError(message);
      throw cause;
    }
  }, []);

  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
  }, []);

  const reset = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    reportPosition(0);
  }, [reportPosition]);

  useImperativeHandle(ref, () => ({play, pause, seek, reset}), [pause, play, reset, seek]);

  const classes = ["media-player", !showControls ? "media-player--headless" : "", className].filter(Boolean).join(" ");
  const seekStyle = {
    "--seek-position": `${duration > 0 ? (Math.min(current, duration) / duration) * 100 : 0}%`,
  } as CSSProperties;
  return <section className={classes} aria-label={label}>
    <audio
      ref={audioRef}
      src={src}
      preload="metadata"
      onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
      onPlay={() => {
        setIsPlaying(true);
        onPlaybackStateChangeRef.current?.(true);
        void (async () => {
          try {
            await onPlayRef.current?.();
          } catch {
            setError("播放事件处理失败，请稍后重试。");
          }
        })();
        stopFrame();
        frameRef.current = requestAnimationFrame(syncFrame);
      }}
      onPause={() => {
        setIsPlaying(false);
        onPlaybackStateChangeRef.current?.(false);
        stopFrame();
        reportPosition(audioRef.current?.currentTime ?? current);
      }}
      onEnded={() => {
        setIsPlaying(false);
        onPlaybackStateChangeRef.current?.(false);
        stopFrame();
        reportPosition(audioRef.current?.duration ?? duration);
      }}
      onTimeUpdate={() => reportPosition(audioRef.current?.currentTime ?? 0)}
      onSeeked={() => reportPosition(audioRef.current?.currentTime ?? 0)}
      onError={() => setError("音频加载失败，请稍后重试。")}
    />
    {showControls && <>
      <div className="media-player__topline">
        <button className="media-player__play" type="button" onClick={togglePlayback} aria-label={isPlaying ? `暂停${label}` : `播放${label}`}>
          {isPlaying ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
        </button>
        <div className="media-player__identity">
          <span className="media-player__label">{label}</span>
          <span className="media-player__time" aria-live="off">{formatPlaybackTime(Math.min(current, duration || current))} / {formatPlaybackTime(duration)}</span>
        </div>
        <button className="media-player__mute" type="button" onClick={() => {
          const audio = audioRef.current;
          if (!audio) return;
          audio.muted = !audio.muted;
          setIsMuted(audio.muted);
        }} aria-label={isMuted ? `取消静音${label}` : `静音${label}`}>
          {isMuted ? <VolumeX size={15} aria-hidden="true" /> : <Volume2 size={15} aria-hidden="true" />}
        </button>
      </div>
      <div className="media-player__seek-row">
        <input
          className="media-player__seek"
          type="range"
          min={0}
          max={duration || 0}
          step="any"
          value={Math.min(current, duration || 0)}
          style={seekStyle}
          onChange={(event) => seek(Number(event.currentTarget.value))}
          disabled={duration <= 0}
          aria-label={`调整${label}播放位置`}
        />
      </div>
    </>}
    {error && <p className="media-player__error" role="status">{error}</p>}
  </section>;
});

MediaPlayer.displayName = "MediaPlayer";
