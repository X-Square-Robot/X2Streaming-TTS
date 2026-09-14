import { useState } from "react";
import { ArrowUpRight, Check, Copy } from "lucide-react";
import { assets, links } from "./assets";
import { useText } from "./i18n";

const citations = [
  `@article{wen2026x2streamingtts,
  title = {X2Streaming-TTS: Causal Token-Level Text-to-Speech from Streaming Text with Speech-State Inheritance},
  author = {Wen, Rime and Liu, Zehan and Qin, Shawn and Shi, Lights and Gan, Roy and Wang, Hao and Wang, Qian},
  journal = {arXiv preprint arXiv:2608.18661},
  year = {2026}
}`,
  `@article{liu2026x2nativecursor,
  title = {X2-NativeCursor: Native-Token Text Progress Tracking for Incremental-Text Streaming Codec TTS},
  author = {Liu, Zehan and Chen, Carl and Wen, Rime and Fu, Kaiqi and Lin, Altman and Qin, Shawn and Shi, Lights and Gan, Roy and Wang, Hao and Wang, Qian},
  journal = {arXiv preprint arXiv:2609.09677},
  year = {2026}
}`,
];

export function Research() {
  const t = useText();
  const [method, setMethod] = useState(0);
  const [citation, setCitation] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const methods = [
    {
      name: t("Causal commitment", "因果承诺"),
      image: assets.pipeline,
      detail: t(
        "Speak only when the reading is settled. Text arrives a piece at a time; the front end commits stable pronunciations and chooses where to close each segment.",
        "读法确定后才开口。文本逐步到达，前端只提交稳定的读音，并根据剩余容量和标点决定片段边界。",
      ),
    },
    {
      name: t("Speech-state inheritance", "语音状态继承"),
      image: assets.inheritance,
      detail: t(
        "Keep the voice continuous across segment boundaries. Healthy decoder state and a bounded acoustic history carry the previous segment into the next.",
        "跨片段保持语音连续。通过健康检查的解码状态和有限声学历史，把上一段的声音接到下一段。",
      ),
    },
    {
      name: "NativeCursor",
      image: assets.cursorMethod,
      detail: t(
        "Read progress from native speech tokens before waveform decoding. The observer maps spoken labels back to the original text; the client follows the playback clock.",
        "在波形解码前，从原生语音 token 中读取进度。观察器把读音映射回原文，客户端再结合播放时钟呈现。",
      ),
    },
  ];
  return (
    <>
      <section className="section research-section" id="method">
        <div className="section-heading">
          <div>
            <p className="eyebrow">
              03 / {t("BEHIND THE VOICE", "声音背后的方法")}
            </p>
            <h2>
              {t(
                "Three ideas. One continuous voice.",
                "三个环节，一段连续的声音。",
              )}
            </h2>
          </div>
          <a
            className="text-button"
            href={links.paper}
            target="_blank"
            rel="noreferrer"
          >
            {t("Read the paper", "阅读论文")}
            <ArrowUpRight size={17} />
          </a>
        </div>
        <div className="method-layout">
          <div
            className="method-menu"
            role="tablist"
            aria-label={t("Methods", "方法")}
          >
            {methods.map((item, index) => (
              <button
                key={index}
                role="tab"
                id={`method-tab-${index}`}
                aria-selected={method === index}
                aria-controls="method-panel"
                onClick={() => setMethod(index)}
              >
                <span>0{index + 1}</span>
                <div>
                  <strong>{item.name}</strong>
                  {method === index && <p>{item.detail}</p>}
                </div>
                <ArrowUpRight size={17} />
              </button>
            ))}
          </div>
          <figure
            className={`method-figure method-${method}`}
            id="method-panel"
            role="tabpanel"
            aria-labelledby={`method-tab-${method}`}
          >
            <img
              src={methods[method]!.image}
              alt={methods[method]!.name}
              loading="lazy"
            />
            <figcaption>
              {t("Figure from the corresponding paper.", "图示来自对应论文。")}
            </figcaption>
          </figure>
        </div>
      </section>
      <section className="section resources-section" id="resources">
        <div className="section-heading">
          <div>
            <p className="eyebrow">04 / {t("OPEN RESEARCH", "开放研究")}</p>
            <h2>{t("Build on this work.", "从这里，继续探索。")}</h2>
          </div>
          <p>
            {t(
              "Explore the code, download the weights, and cite the work in your research.",
              "获取代码和权重，也欢迎在研究中引用我们的工作。",
            )}
          </p>
        </div>
        <div className="resource-links">
          {[
            {
              title: "GitHub",
              label: t("Method implementation", "方法实现"),
              href: links.code,
            },
            {
              title: "X2Streaming-TTS",
              label: t("Model weights · 1.7B", "模型权重 · 1.7B"),
              href: links.model,
            },
            {
              title: "X2-NativeCursor",
              label: t("Progress observer weights", "进度观察器权重"),
              href: links.cursorModel,
            },
          ].map((item) => (
            <a
              href={item.href}
              key={item.title}
              target="_blank"
              rel="noreferrer"
            >
              <span>
                <small>{item.label}</small>
                <strong>{item.title}</strong>
              </span>
              <ArrowUpRight size={22} />
            </a>
          ))}
        </div>
        <div className="citation-box">
          <div className="citation-toolbar">
            <div role="tablist" aria-label="Citation">
              {["X2Streaming-TTS", "X2-NativeCursor"].map((name, index) => (
                <button
                  key={name}
                  role="tab"
                  aria-selected={citation === index}
                  onClick={() => {
                    setCitation(index);
                    setCopied(false);
                    setCopyError(false);
                  }}
                >
                  {name}
                </button>
              ))}
            </div>
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(citations[citation]!);
                  setCopied(true);
                  setCopyError(false);
                } catch {
                  setCopyError(true);
                }
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}{" "}
              {copied ? t("Copied", "已复制") : t("Copy BibTeX", "复制 BibTeX")}
            </button>
          </div>
          <pre>
            <code>{citations[citation]}</code>
          </pre>
          {copyError && (
            <p role="status">
              {t(
                "Select and copy the citation below.",
                "请选中引用内容并手动复制。",
              )}
            </p>
          )}
        </div>
      </section>
    </>
  );
}
