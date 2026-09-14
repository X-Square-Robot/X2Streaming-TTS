import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Code2,
  Globe2,
  Play,
  X,
} from "lucide-react";
import { assets, links } from "./assets";
import { LanguageContext, useText, type Locale } from "./i18n";
import { Studio } from "./Studio";
import { Research } from "./Research";
import { QuickStart } from "./QuickStart";

export function App() {
  const [locale, setLocale] = useState<Locale>("en");
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);
  useEffect(() => {
    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.href = assets.mascot;
    document.head.append(icon);
    return () => icon.remove();
  }, []);
  return (
    <LanguageContext.Provider value={locale}>
      <Page
        locale={locale}
        toggleLocale={() => setLocale(locale === "en" ? "zh" : "en")}
      />
    </LanguageContext.Provider>
  );
}

function Page({
  locale,
  toggleLocale,
}: {
  locale: Locale;
  toggleLocale: () => void;
}) {
  const t = useText();
  return (
    <>
      <a className="skip-link" href="#demo">
        {t("Skip to demo", "跳转到演示")}
      </a>
      <header className="site-header">
        <div className="nav-inner">
          <a className="brand" href="#" aria-label="X2Streaming-TTS home">
            <img src={assets.mascot} alt="" />
            <span>
              X2<span className="brand-light">Streaming</span>
              <b> / </b>TTS
            </span>
          </a>
          <nav aria-label={t("Main navigation", "主导航")}>
            <a href="#scenarios">{t("What it does", "能做什么")}</a>
            <a href="#quickstart">{t("Quick start", "自己试试")}</a>
            <a href="#resources">{t("Resources", "资源")}</a>
          </nav>
          <div className="nav-actions">
            <button
              className="language-button"
              onClick={toggleLocale}
              aria-label={locale === "en" ? "切换到中文" : "Switch to English"}
            >
              <Globe2 size={15} />
              {locale === "en" ? "中文" : "EN"}
            </button>
            <a
              className="nav-code"
              aria-label="GitHub"
              href={links.code}
              target="_blank"
              rel="noreferrer"
            >
              <Code2 size={16} />
              <span>GitHub</span>
              <ArrowUpRight size={13} />
            </a>
          </div>
        </div>
      </header>
      <main>
        <section className="hero section" id="overview">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="tiny-square" />X SQUARE ROBOT{" "}
              <span className="eyebrow-divider">/</span>{" "}
              {t("SPEECH RESEARCH", "语音研究")}
            </p>
            <h1>
              {t("Words in motion.", "文字未完，")}
              <br />
              <em>{t("Speech in sync.", "声音已至。")}</em>
            </h1>
            <p className="hero-description">
              {t(
                "Speak while the next word is still arriving. Keep the voice continuous, and every highlight in step with what you hear.",
                "下一段文字还在到达，语音已经开始。跨片段延续声音，让每一步高亮，都跟上耳边的朗读。",
              )}
            </p>
            <div className="project-line">
              <strong>X2Streaming-TTS</strong>
              <span>+</span>
              <strong>X2-NativeCursor</strong>
            </div>
            <div className="hero-actions">
              <a className="button button-primary" href="#scenarios">
                <Play size={16} fill="currentColor" />
                {t("Watch the demos", "看演示")}
                <ArrowRight size={17} />
              </a>
              <a
                className="button button-outline"
                href={links.paper}
                target="_blank"
                rel="noreferrer"
              >
                <BookOpen size={17} />
                {t("Read the paper", "阅读论文")}
                <ArrowUpRight size={15} />
              </a>
            </div>
            <div className="hero-footnote">
              <span className="status-dot" />
              {t("Open code & weights", "代码与权重开放")}
              <span>·</span>
              {t("Built for streaming conversations", "面向流式对话")}
            </div>
          </div>
          <div className="hero-art">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <span className="art-caption">
              A LITTLE BEAVER.
              <br />A CONTINUOUS VOICE.
            </span>
            <img
              src={assets.mascot}
              className="hero-mascot"
              alt={t(
                "Our aviator-goggle beaver mascot holding the moon with both hands",
                "我们的河狸吉祥物，戴着飞行眼镜，双手举起月亮",
              )}
            />
            <div className="art-label">
              <span className="label-mark" />
              <span>
                {t("Ready for the next word.", "准备好，接住下一个字。")}
              </span>
            </div>
            <span className="art-index">X2 / 2026</span>
          </div>
        </section>
        <div className="capability-ribbon">
          <div>
            <span>01</span>
            {t("Speak as text arrives", "边接收文本，边说话")}
          </div>
          <div>
            <span>02</span>
            {t("Continue across segments", "跨片段，保持连续")}
          </div>
          <div>
            <span>03</span>
            {t("Follow every spoken word", "随朗读，同步高亮")}
          </div>
          <a href="#demo" aria-label={t("Go to the demo", "前往演示")}>
            <ArrowDown size={19} />
          </a>
        </div>
        <Scenarios />
        <Studio />
        <QuickStart />
        <Research />
      </main>
      <footer className="site-footer">
        <a className="footer-brand" href="#">
          <img src={assets.mascot} alt="" />
          <span>X Square Robot</span>
        </a>
        <p>
          {t("A voice that stays with the conversation.", "让声音，跟上对话。")}
        </p>
        <span>
          © 2026 XSquareRobot{" "}
          <a
            href={`${links.code}/blob/main/LICENSE`}
            target="_blank"
            rel="noreferrer"
          >
            Code · MIT
          </a>
          <a
            href={`${import.meta.env.BASE_URL}THIRD_PARTY_NOTICES.txt`}
            target="_blank"
            rel="noreferrer"
          >
            {t("Notices", "来源声明")}
          </a>
        </span>
      </footer>
    </>
  );
}

function Scenarios() {
  const t = useText();
  const [selected, setSelected] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const items = [
    {
      image: assets.streaming,
      title: t("Before the sentence is finished.", "句子没写完，也能先开口。"),
      category: "STREAMING INPUT",
      body: t(
        "Watch streamed text begin speaking while full-text synthesis waits for the last word.",
        "观察流式输入提前发声，而完整输入等待最后一个字的过程。",
      ),
    },
    {
      image: assets.player,
      title: t("A voice that carries on.", "一段接一段，声音不断。"),
      category: "CONTINUOUS PLAYBACK",
      body: t(
        "See decoded audio chunks and playback progress in the original text player.",
        "在原始文本播放器中，观察音频块解码与播放进度。",
      ),
    },
    {
      image: assets.concurrency,
      title: t("Many conversations. One engine.", "多段对话，同一个引擎。"),
      category: "CONCURRENT STREAMS",
      body: t(
        "A recorded 128-session run, with each stream’s first-audio timing visible.",
        "128 路并发会话的真实录屏，展示每一路的首音频时延。",
      ),
    },
  ];
  return (
    <section className="section scenarios-section" id="scenarios">
      <div className="section-heading">
        <div>
          <p className="eyebrow">01 / {t("WHAT YOU CAN DO", "能做什么")}</p>
          <h2>
            {t(
              "Start sooner. Speak continuously.",
              "更早开口，让对话顺畅继续。",
            )}
          </h2>
        </div>
        <p>
          {t(
            "Three short recordings show what streaming speech changes. Click any clip to take a closer look.",
            "用三个真实录屏，看清流式语音能带来什么。点击画面即可放大观看。",
          )}
        </p>
      </div>
      <div className="scenario-grid">
        {items.map((item, index) => (
          <article className="scenario-card" key={item.category}>
            <button
              className="scenario-preview"
              onClick={() => {
                setSelected(index);
                dialog.current?.showModal();
              }}
              aria-label={`${t("View recording", "查看录屏")}: ${item.title}`}
            >
              <img src={item.image} alt="" loading="lazy" />
              <span className="preview-button">
                <Play size={17} fill="currentColor" />
              </span>
            </button>
            <div className="scenario-info">
              <span className="eyebrow">{item.category}</span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              <button
                className="text-button"
                onClick={() => {
                  setSelected(index);
                  dialog.current?.showModal();
                }}
              >
                {t("View recording", "查看录屏")}
                <ArrowUpRight size={16} />
              </button>
            </div>
          </article>
        ))}
      </div>
      <dialog
        ref={dialog}
        className="recording-dialog"
        onClick={(event) => {
          if (event.target === dialog.current) dialog.current.close();
        }}
      >
        <div className="dialog-heading">
          <div>
            <span className="eyebrow">
              {t("SILENT SCREEN RECORDING", "无声屏幕录制")}
            </span>
            <h3>{items[selected]!.title}</h3>
          </div>
          <button
            className="icon-button"
            onClick={() => dialog.current?.close()}
            aria-label={t("Close recording", "关闭录屏")}
          >
            <X size={22} />
          </button>
        </div>
        <img src={items[selected]!.image} alt={items[selected]!.body} />
        <p>{items[selected]!.body}</p>
      </dialog>
    </section>
  );
}
