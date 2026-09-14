import {describe, expect, it} from "vitest";

import {BrowserAudioPlayer, DEFAULT_MAX_BUFFER_MS} from "./browser-audio-player.js";
import {ContinuousResampler} from "./resampler.js";
import {WavCollector} from "./wav-collector.js";

describe("ContinuousResampler", () => {
  it.each([[16_000, 48_000], [24_000, 48_000], [24_000, 44_100]])(
    "produces the same samples across split and unsplit %i -> %i input",
    (sourceRate, outputRate) => {
    const source = Float32Array.from({length: 100}, (_, index) => Math.sin(index / 10));
    const whole = new ContinuousResampler(sourceRate, outputRate);
    const expected = [...whole.process(source), ...whole.flush()];
    expect(whole.consumedSourceFrames()).toBe(source.length);
    const split = new ContinuousResampler(sourceRate, outputRate);
    const actual = [
      ...split.process(source.subarray(0, 17)),
      ...split.process(source.subarray(17, 53)),
      ...split.process(source.subarray(53)),
      ...split.flush(),
    ];
    expect(split.consumedSourceFrames()).toBe(source.length);
    expect(actual.length).toBe(expected.length);
    actual.forEach((sample, index) => expect(sample).toBeCloseTo(expected[index] ?? 0, 6));
    },
  );
});

describe("WavCollector", () => {
  it("writes a valid bounded mono PCM16 WAV", () => {
    const collector = new WavCollector({sampleRate: 24_000, maxBytes: 50});
    expect(collector.append(Int16Array.of(1, -2, 3, 4))).toBe(false);
    const snapshot = collector.snapshot();
    expect(snapshot).toMatchObject({samples: 3, pcmBytes: 6, limitReached: true});
    const wav = collector.toArrayBuffer();
    const bytes = new Uint8Array(wav);
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe("WAVE");
    expect(new DataView(wav).getUint32(40, true)).toBe(6);
  });

  it("copies appended buffers so callers can reuse transport memory", () => {
    const collector = new WavCollector({sampleRate: 16_000});
    const samples = Int16Array.of(123);
    collector.append(samples);
    samples[0] = 456;
    expect(new DataView(collector.toArrayBuffer()).getInt16(44, true)).toBe(123);
  });
});

describe("BrowserAudioPlayer float input", () => {
  it("falls back to scheduled buffers when AudioWorklet is unavailable", async () => {
    const originalContext = globalThis.AudioContext;
    const originalNode = globalThis.AudioWorkletNode;
    const sources: FakeScheduledSource[] = [];
    class FakeScheduledSource {
      buffer: unknown = null;
      onended: (() => void) | null = null;
      connect() {}
      disconnect() {}
      start() {}
      stop() {}
      finish() { this.onended?.(); }
    }
    class FakeContext {
      sampleRate = 48_000; currentTime = 0; destination = {};
      createGain() { return {gain: {setValueAtTime() {}}, connect: () => this.destination, disconnect() {}}; }
      createBuffer(_channels: number, length: number) {
        return {getChannelData() { return new Float32Array(length); }};
      }
      createBufferSource() {
        const source = new FakeScheduledSource();
        sources.push(source);
        return source;
      }
      async resume() {} async suspend() {} async close() {}
    }
    Object.assign(globalThis, {AudioContext: FakeContext, AudioWorkletNode: undefined});
    try {
      const progress: Array<[bigint, bigint]> = [];
      let fallbacks = 0;
      const player = new BrowserAudioPlayer({
        onFallback: () => { fallbacks += 1; },
        onPlaybackProgress: (played, buffered) => progress.push([played, buffered]),
      });
      await player.start();
      expect(player.snapshot().backend).toBe("scheduled-buffer");
      expect(fallbacks).toBe(1);
      player.enqueue(Float32Array.of(-1, 0, 1), 48_000, 0n, 3n);
      player.flush();
      for (const source of sources) source.finish();
      const finalProgress = progress.at(-1);
      expect(finalProgress?.[0]).toBeGreaterThan(0n);
      expect(finalProgress?.[0]).toBe(finalProgress?.[1]);
      await player.close();
    } finally {
      Object.assign(globalThis, {AudioContext: originalContext, AudioWorkletNode: originalNode});
    }
  });

  it("accepts a self-hosted AudioWorklet module URL", async () => {
    const originalContext = globalThis.AudioContext;
    const originalNode = globalThis.AudioWorkletNode;
    let addedModule = "";
    class FakeNode {
      port = {onmessage: null, postMessage() {}};
      connect() { return {connect() {}}; }
      disconnect() {}
    }
    class FakeContext {
      sampleRate = 48_000; currentTime = 0; destination = {};
      audioWorklet = {addModule: async (url: string) => { addedModule = url; }};
      createGain() { return {gain: {setValueAtTime() {}}, connect: () => this.destination, disconnect() {}}; }
      async resume() {} async suspend() {} async close() {}
    }
    Object.assign(globalThis, {AudioContext: FakeContext, AudioWorkletNode: FakeNode});
    try {
      const player = new BrowserAudioPlayer({workletModuleUrl: "/assets/qwen-pcm-worklet.js"});
      await player.start();
      expect(addedModule).toBe("/assets/qwen-pcm-worklet.js");
      await player.close();
    } finally {
      Object.assign(globalThis, {AudioContext: originalContext, AudioWorkletNode: originalNode});
    }
  });

  it("uses a large safety bound and passes explicit bounds to the AudioWorklet", async () => {
    const originalContext = globalThis.AudioContext;
    const originalNode = globalThis.AudioWorkletNode;
    let nodeOptions: AudioWorkletNodeOptions | undefined;
    class FakeNode {
      port = {onmessage: null, postMessage() {}};
      constructor(_context: AudioContext, _name: string, options?: AudioWorkletNodeOptions) {
        nodeOptions = options;
      }
      connect() { return {connect() {}}; }
      disconnect() {}
    }
    class FakeContext {
      sampleRate = 48_000; currentTime = 0; destination = {};
      audioWorklet = {addModule: async () => undefined};
      createGain() { return {gain: {setValueAtTime() {}}, connect: () => this.destination, disconnect() {}}; }
      async resume() {} async suspend() {} async close() {}
    }
    Object.assign(globalThis, {AudioContext: FakeContext, AudioWorkletNode: FakeNode});
    try {
      const defaultPlayer = new BrowserAudioPlayer();
      await defaultPlayer.start();
      expect(DEFAULT_MAX_BUFFER_MS).toBe(3_600_000);
      expect(nodeOptions?.processorOptions).toEqual({maxQueuedFrames: 172_800_000});
      await defaultPlayer.close();

      const player = new BrowserAudioPlayer({maxBufferMs: 7_500});
      await player.start();
      expect(nodeOptions?.processorOptions).toEqual({maxQueuedFrames: 360_000});
      await player.close();
    } finally {
      Object.assign(globalThis, {AudioContext: originalContext, AudioWorkletNode: originalNode});
    }
  });

  it("rejects invalid queue bounds", () => {
    expect(() => new BrowserAudioPlayer({maxBufferMs: 0})).toThrow("positive finite");
    expect(() => new BrowserAudioPlayer({maxBufferMs: Number.NaN})).toThrow("positive finite");
  });

  it("accepts bounded PCM float and rejects invalid samples before queueing", async () => {
    const originalContext = globalThis.AudioContext;
    const originalNode = globalThis.AudioWorkletNode;
    class FakeNode {
      port = {onmessage: null, postMessage() {}};
      connect() { return {connect() {}}; }
      disconnect() {}
    }
    class FakeContext {
      sampleRate = 48_000; currentTime = 0; destination = {};
      audioWorklet = {addModule: async () => undefined};
      createGain() { return {gain: {setValueAtTime() {}}, connect: () => this.destination, disconnect() {}}; }
      async resume() {} async suspend() {} async close() {}
    }
    Object.assign(globalThis, {AudioContext: FakeContext, AudioWorkletNode: FakeNode});
    try {
      const player = new BrowserAudioPlayer();
      await player.start();
      expect(player.supportsOutputDeviceSelection()).toBe(false);
      player.enqueue(Float32Array.of(-1, 0, 1), 24_000, 0n, 3n);
      expect(() => player.enqueue(Float32Array.of(2), 24_000, 3n, 4n)).toThrow("between -1 and 1");
      await player.close();
    } finally {
      Object.assign(globalThis, {AudioContext: originalContext, AudioWorkletNode: originalNode});
    }
  });

  it("tracks real consumption, pause, underrun, output device and queue bounds", async () => {
    const originalContext = globalThis.AudioContext;
    const originalNode = globalThis.AudioWorkletNode;
    class FakePort {
      onmessage: ((event: MessageEvent) => void) | null = null;
      readonly sent: Array<Record<string, unknown>> = [];
      postMessage(payload: Record<string, unknown>) { this.sent.push(payload); }
      emit(payload: Record<string, unknown>) {
        this.onmessage?.({data: payload} as MessageEvent);
      }
    }
    class FakeNode {
      static latest: FakeNode | null = null;
      readonly port = new FakePort();
      constructor() { FakeNode.latest = this; }
      connect(target: unknown) { return target as {connect: (destination: unknown) => unknown}; }
      disconnect() {}
    }
    class FakeContext {
      sampleRate = 48_000; currentTime = 0; destination = {};
      audioWorklet = {addModule: async () => undefined};
      createGain() { return {gain: {setValueAtTime() {}}, connect: () => this.destination, disconnect() {}}; }
      async resume() {} async suspend() {} async close() {}
      async setSinkId() {}
    }
    Object.assign(globalThis, {AudioContext: FakeContext, AudioWorkletNode: FakeNode});
    try {
      const progress: Array<[bigint, bigint]> = [];
      let underruns = 0;
      const player = new BrowserAudioPlayer({
        onPlaybackProgress: (played, buffered) => progress.push([played, buffered]),
        onUnderrun: () => { underruns += 1; },
      });
      await player.start();
      expect(player.supportsOutputDeviceSelection()).toBe(true);
      await expect(player.setOutputDevice("speaker-1")).resolves.toBe(true);
      player.enqueue(new Int16Array(24), 24_000, 0n, 24n);
      player.flush();
      const port = FakeNode.latest?.port;
      const pushed = port?.sent
        .filter((message) => message.type === "push")
        .map((message) => message.samples);
      expect(pushed?.every((samples) => samples instanceof ArrayBuffer)).toBe(true);
      const outputFrames = pushed?.reduce(
        (total, samples) => total + new Float32Array(samples as ArrayBuffer).length,
        0,
      ) ?? 0;
      port?.emit({type: "consumed", frames: outputFrames});
      port?.emit({type: "underrun"});
      expect(progress.at(-1)).toEqual([24n, 24n]);
      expect(underruns).toBe(1);
      await player.pause();
      expect(player.snapshot().paused).toBe(true);
      await player.resume();
      expect(player.snapshot().paused).toBe(false);
      await player.close();

      const bounded = new BrowserAudioPlayer({maxBufferMs: 1});
      await bounded.start();
      expect(() => bounded.enqueue(new Int16Array(100), 24_000, 0n, 100n))
        .toThrow("queue is full");
      await bounded.close();
    } finally {
      Object.assign(globalThis, {AudioContext: originalContext, AudioWorkletNode: originalNode});
    }
  });
});
