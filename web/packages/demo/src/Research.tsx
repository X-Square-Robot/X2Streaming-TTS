import { useState } from "react";
import { ArrowUpRight, Check, Copy } from "lucide-react";
import { links } from "./assets";
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
  const [citation, setCitation] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  return (
    <>
      <section className="section resources-section" id="resources">
        <div className="section-heading">
          <div>
            <p className="eyebrow">04 / {t("PAPERS & MODELS", "论文与模型")}</p>
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
        <p className="paper-links">
          <a href={links.paper} target="_blank" rel="noreferrer">
            X2Streaming-TTS {t("paper", "论文")} ↗
          </a>
          <a href={links.cursorPaper} target="_blank" rel="noreferrer">
            X2-NativeCursor {t("paper", "论文")} ↗
          </a>
        </p>
        <details className="citation-details">
          <summary>{t("Cite this work", "引用这项工作")}</summary>
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
                {copied
                  ? t("Copied", "已复制")
                  : t("Copy BibTeX", "复制 BibTeX")}
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
        </details>
      </section>
    </>
  );
}
