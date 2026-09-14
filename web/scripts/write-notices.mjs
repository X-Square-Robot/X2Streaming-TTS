import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "packages/demo/public/THIRD_PARTY_NOTICES.txt");
const parts = [await readFile(resolve(root, "NOTICE"), "utf8")];
for (const [name, path] of [
  ["X2Streaming-TTS / Qwen3TTS-Streaming browser components", "../LICENSE"],
  ...["react", "react-dom", "scheduler", "lucide-react", "zod"].map((name) => [
    name,
    `node_modules/${name}/LICENSE`,
  ]),
]) {
  parts.push(
    `${name}\n${"=".repeat(name.length)}\n\n${await readFile(resolve(root, path), "utf8")}`,
  );
}
await mkdir(resolve(root, "packages/demo/public"), { recursive: true });
await writeFile(output, parts.join("\n\n"));
