import {useId} from "react";

import type {AudioEnvelope} from "./audio-envelope";
import "./media.css";

export interface PlaybackWaveformProps {
  readonly envelope: readonly AudioEnvelope[];
  readonly playedSample: bigint;
}

function sampleToX(sample: number, start: number, span: number): number {
  return ((sample - start) / span) * 600;
}

export function PlaybackWaveform({envelope, playedSample}: PlaybackWaveformProps) {
  const clipId = `waveform-played-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const first = envelope[0];
  const last = envelope.at(-1);
  const start = first?.start ?? 0;
  const end = last?.end ?? 1;
  const span = Math.max(1, end - start);
  const played = Number(playedSample);
  const playedX = envelope.length === 0 ? 0 : Math.min(600, Math.max(0, sampleToX(played, start, span)));

  return <svg className="waveform waveform-svg" viewBox="0 0 600 100" role="img" aria-label="音频波形与播放位置" preserveAspectRatio="none">
    <defs>
      <clipPath id={clipId}>
        <rect x="0" y="0" width={playedX} height="100" />
      </clipPath>
    </defs>
    <line className="waveform__baseline" x1="0" x2="600" y1="50" y2="50" />
    {envelope.length > 0 && <>
      <g className="waveform__bars">
        {envelope.map((item, index) => {
          const x = sampleToX(item.start, start, span);
          const width = Math.max(1, sampleToX(item.end, start, span) - x);
          const height = Math.max(2, Math.min(46, item.peak * 46));
          return <rect key={`${item.start}-${item.end}-${index}`} x={x} y={50 - height} width={width} height={height * 2} rx="1" />;
        })}
      </g>
      <g className="waveform__bars waveform__bars--played" clipPath={`url(#${clipId})`} aria-hidden="true">
        {envelope.map((item, index) => {
          const x = sampleToX(item.start, start, span);
          const width = Math.max(1, sampleToX(item.end, start, span) - x);
          const height = Math.max(2, Math.min(46, item.peak * 46));
          return <rect key={`${item.start}-${item.end}-${index}`} x={x} y={50 - height} width={width} height={height * 2} rx="1" />;
        })}
      </g>
    </>}
    <line className="waveform__playhead" x1={playedX} x2={playedX} y1="8" y2="92" />
  </svg>;
}
