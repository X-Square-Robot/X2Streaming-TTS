import type {CSSProperties} from "react";

import "./media.css";

export interface ProgressTrackProps {
  readonly value: number;
  readonly max?: number;
  readonly buffered?: number;
  readonly label: string;
  readonly className?: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

/** A compact, read-only progress indicator for text cursors and live audio. */
export function ProgressTrack({value, max = 1, buffered = 0, label, className}: ProgressTrackProps) {
  const safeMax = Math.max(0, Number.isFinite(max) ? max : 0);
  const played = clamp(value, 0, safeMax);
  const bufferedValue = clamp(buffered, played, safeMax);
  const playedRatio = safeMax === 0 ? 0 : (played / safeMax) * 100;
  const bufferedRatio = safeMax === 0 ? 0 : (bufferedValue / safeMax) * 100;
  const classes = ["progress-track", className].filter(Boolean).join(" ");
  const style = {
    "--progress-played": `${playedRatio}%`,
    "--progress-buffered": `${bufferedRatio}%`,
  } as CSSProperties;

  return <div
    className={classes}
    role="progressbar"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={safeMax}
    aria-valuenow={played}
    style={style}
  >
    <span className="progress-track__rail" aria-hidden="true">
      <span className="progress-track__buffered" />
      <span className="progress-track__played" />
      <span className="progress-track__dot" />
    </span>
  </div>;
}
