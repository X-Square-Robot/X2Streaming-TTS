import { useState } from "react";
import { ArrowRight, Check, Copy, Download, Terminal } from "lucide-react";
import { useText } from "./i18n";
import { links } from "./assets";

export const quickStartCommand = `git clone https://github.com/X-Square-Robot/X2Streaming-TTS.git
cd X2Streaming-TTS
bash quickstart.sh --public`;

export function QuickStart() {
  const t = useText();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  return (
    <section className="section quickstart-section" id="quickstart">
      <div className="section-heading">
        <div>
          <p className="eyebrow">03 / QUICK START</p>
          <h2>
            {t("Try it with your own words.", "换成你的文字，自己试试。")}
          </h2>
        </div>
        <p>
          {t(
            "Run one script on your GPU machine. Copy its address into the playground and start speaking.",
            "在 GPU 机器上运行脚本，把生成的地址填入体验区，即可开始。",
          )}
        </p>
      </div>
      <div className="quickstart-layout">
        <ol className="quickstart-steps">
          <li>
            <span>1</span>
            <div>
              <h3>{t("Start the service", "运行启动脚本")}</h3>
              <p>
                {t(
                  "Downloads the matching weights and builds and starts the speech engine.",
                  "自动下载配套权重，完成引擎构建并启动服务。",
                )}
              </p>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <h3>{t("Copy your WebSocket address", "复制 WebSocket 地址")}</h3>
              <p>
                {t(
                  "The script prints it after the service passes an audio check.",
                  "服务通过音频检查后，终端会提示可用地址。",
                )}
              </p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <h3>{t("Paste it and listen", "粘贴地址，开始试听")}</h3>
              <p>
                {t(
                  "Open Live playground, connect, and enter your text.",
                  "打开实时体验，连接服务，再输入想说的话。",
                )}
              </p>
            </div>
          </li>
        </ol>
        <div className="quickstart-terminal">
          <div className="terminal-toolbar">
            <span>
              <Terminal size={15} />
              {t("ON YOUR GPU MACHINE", "在 GPU 机器上运行")}
            </span>
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(quickStartCommand);
                  setCopied(true);
                  setError(false);
                } catch {
                  setError(true);
                }
              }}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}{" "}
              {copied ? t("Copied", "已复制") : t("Copy commands", "复制命令")}
            </button>
          </div>
          <pre>
            <code>{quickStartCommand}</code>
          </pre>
          <div className="terminal-output">
            <small>
              {t("After the audio check succeeds", "音频检查成功后会看到")}
            </small>
            <p>{t("Your WebSocket address is:", "您的 WebSocket 地址是：")}</p>
            <code>wss://…trycloudflare.com/…/v1/realtime</code>
          </div>
          {error && (
            <p role="status">
              {t(
                "Select and copy the commands above.",
                "请选中上面的命令并复制。",
              )}
            </p>
          )}
        </div>
      </div>
      <div className="quickstart-footer">
        <p>
          {t(
            "Linux · Python 3.12+ · NVIDIA GPU · Docker + NVIDIA Container Toolkit. The first build takes time. --public creates a temporary public WSS address.",
            "需要 Linux、Python 3.12+、NVIDIA GPU、Docker 和 NVIDIA Container Toolkit。首次构建需要等待；--public 会创建临时公开 WSS 地址。",
          )}
        </p>
        <div>
          <a
            className="text-button"
            href={`${import.meta.env.BASE_URL}x2streaming-quickstart.zip`}
            download
          >
            <Download size={15} />
            {t("Download starter", "下载启动包")}
          </a>
          <a
            className="text-button"
            href={`${links.code}/blob/main/docs/quickstart.md`}
            target="_blank"
            rel="noreferrer"
          >
            {t("Setup guide", "启动说明")} ↗
          </a>
          <a className="button button-primary" href="#live">
            {t("Open playground", "打开实时体验")}
            <ArrowRight size={16} />
          </a>
        </div>
      </div>
    </section>
  );
}
