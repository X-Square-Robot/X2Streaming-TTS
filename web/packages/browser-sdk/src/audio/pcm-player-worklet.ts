/** Runaway protection only; queued audio is allocated incrementally. */
export const DEFAULT_MAX_BUFFER_MS = 60 * 60 * 1_000;

export const PCM_PLAYER_WORKLET_SOURCE = String.raw`
const DEFAULT_MAX_QUEUED_FRAMES = 48_000 * ${DEFAULT_MAX_BUFFER_MS / 1_000};

class QwenPcmPlayerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const configuredMax = Number(options?.processorOptions?.maxQueuedFrames);
    this.maxQueuedFrames = Number.isSafeInteger(configuredMax) && configuredMax > 0
      ? configuredMax
      : DEFAULT_MAX_QUEUED_FRAMES;
    this.chunks = [];
    this.chunkOffset = 0;
    this.queuedFrames = 0;
    this.consumedSinceReport = 0;
    this.paused = false;
    this.underrunReported = false;
    this.port.onmessage = (message) => {
      const payload = message.data;
      if (payload.type === "push" && payload.samples instanceof ArrayBuffer) {
        const samples = new Float32Array(payload.samples);
        if (this.queuedFrames + samples.length > this.maxQueuedFrames) {
          this.port.postMessage({type: "overflow", queuedFrames: this.queuedFrames});
          return;
        }
        this.chunks.push(samples);
        this.queuedFrames += samples.length;
        this.underrunReported = false;
      } else if (payload.type === "clear") {
        this.chunks = [];
        this.chunkOffset = 0;
        this.queuedFrames = 0;
      } else if (payload.type === "pause") {
        this.paused = true;
      } else if (payload.type === "resume") {
        this.paused = false;
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output || this.paused) return true;
    let outputOffset = 0;
    while (outputOffset < output.length && this.chunks.length > 0) {
      const chunk = this.chunks[0];
      if (!chunk) break;
      const count = Math.min(output.length - outputOffset, chunk.length - this.chunkOffset);
      output.set(chunk.subarray(this.chunkOffset, this.chunkOffset + count), outputOffset);
      outputOffset += count;
      this.chunkOffset += count;
      this.queuedFrames -= count;
      this.consumedSinceReport += count;
      if (this.chunkOffset === chunk.length) {
        this.chunks.shift();
        this.chunkOffset = 0;
      }
    }
    if (this.consumedSinceReport >= 1024 || (this.queuedFrames === 0 && this.consumedSinceReport > 0)) {
      this.port.postMessage({type: "consumed", frames: this.consumedSinceReport});
      this.consumedSinceReport = 0;
    }
    if (outputOffset === 0 && !this.underrunReported) {
      this.underrunReported = true;
      this.port.postMessage({type: "underrun"});
    }
    return true;
  }
}

registerProcessor("qwen3tts-pcm-player", QwenPcmPlayerProcessor);
`;
