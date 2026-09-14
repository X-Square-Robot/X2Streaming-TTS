// Local protocol fixture. Emits a quiet test tone, not synthesized speech.
// Never imported by the site or included in its production bundle.
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const capabilities = {
  schema_version: "qwen.tts.capabilities.v1",
  engine_version: "contract-fixture",
  model: "contract-fixture",
  tasks: ["custom_voice"],
  speakers: ["TEST TONE — not a TTS model"],
  languages: ["auto", "Chinese", "English"],
  task_status: [{ task: "custom_voice", available: true, stability: "stable" }],
  input_modes: ["full_text", "token"],
  audio_formats: [{ encoding: "pcm_s16le", sample_rate: 24000, channels: 1 }],
  output_policy: {
    features: ["vad_policy", "emit_text_events", "guarded_delivery"],
    vad_strategies: ["disabled"],
  },
  limits: { max_input_tokens: 4096, max_realtime_message_bytes: 8_388_608 },
  reference: {
    available: false,
    max_duration_sec: 0,
    max_bytes: 4_194_304,
    mime_types: ["audio/wav"],
    reason: "test fixture",
  },
  protocols: {
    openai_realtime: {
      path: "/v1/realtime",
      base: "openai-realtime-v1",
      extension_protocol: "qwen-realtime-v1",
      supported_extensions: [
        "qwen.input_text_buffer.v1",
        "qwen.text_progress.v1",
        "qwen.playback_ack.v1",
        "qwen.response_resume.v1",
      ],
      features: ["playback_ack"],
      audio_formats: ["pcm_s16le"],
    },
  },
};
const server = createServer((req, res) => {
  if (req.url !== "/v1/capabilities") {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(capabilities));
});
const wss = new WebSocketServer({ server, path: "/v1/realtime" });
wss.on("connection", (socket) => {
  let sequence = 0,
    index = 0,
    input = "",
    committed = false,
    timer,
    responseId = "";
  const send = (event) => {
    if (socket.readyState === 1) socket.send(JSON.stringify(event));
  };
  const stop = () => clearInterval(timer);
  send({ type: "session.created", session: { id: "fixture" } });
  socket.on("message", (data) => {
    const event = JSON.parse(String(data));
    if (event.type !== "qwen.playback.ack") console.log(event.type);
    if (event.type === "session.update")
      send({ type: "session.updated", session: { id: "fixture" } });
    if (event.type === "conversation.item.create") {
      input = event.item.content[0].text;
      committed = true;
    }
    if (event.type === "qwen.input_text_buffer.append") {
      input += event.text;
      send({ type: "qwen.input_text_buffer.ack", sequence: event.sequence });
    }
    if (event.type === "qwen.input_text_buffer.commit") committed = true;
    if (event.type === "response.cancel") {
      stop();
      send({
        type: "response.done",
        qwen_delivery_seq: ++sequence,
        response: { id: responseId, status: "cancelled" },
      });
    }
    if (event.type === "response.create") {
      responseId = `fixture_${Date.now()}`;
      send({ type: "response.created", response: { id: responseId } });
      timer = setInterval(() => {
        const chars = Array.from(input);
        if (index >= chars.length) {
          if (committed) {
            stop();
            send({
              type: "response.done",
              qwen_delivery_seq: ++sequence,
              response: {
                id: responseId,
                status: "completed",
                metadata: { qwen_server_ttft_ms: "100" },
              },
            });
          }
          return;
        }
        const samples = 4800,
          start = index * samples;
        const pcm = Buffer.alloc(samples * 2);
        for (let i = 0; i < samples; i++)
          pcm.writeInt16LE(
            Math.round(
              Math.sin(((start + i) / 24000) * 2 * Math.PI * 220) * 300,
            ),
            i * 2,
          );
        index++;
        send({
          type: "response.output_audio.delta",
          response_id: responseId,
          delta: pcm.toString("base64"),
          qwen_delivery_seq: ++sequence,
          qwen_output_sample_start: start,
          qwen_output_sample_end: start + samples,
        });
        send({
          type: "qwen.text_progress",
          response_id: responseId,
          text: chars[index - 1],
          qwen_delivery_seq: ++sequence,
          meta: {
            output_sample_end: start + samples,
            raw_codepoint_end: index,
            display_raw_position: index,
            progress_basis: "contract_test_fixture",
            anchor_seq: index,
          },
        });
      }, 100);
    }
  });
  socket.on("close", stop);
});
server.listen(4174, "127.0.0.1", () =>
  console.log(
    "Protocol fixture only: ws://127.0.0.1:4174/v1/realtime (test tone, no model)",
  ),
);
