// 用无头浏览器的 CDP 精确模拟侧边栏宽度并截图（避免 --window-size 的裁切问题）
import fs from "node:fs";
import path from "node:path";

const port = process.argv[2] || "9333";
const baseUrl = process.argv[3];
const outDir = process.argv[4];

const created = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(created.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const myId = ++id;
  pending.set(myId, { resolve, reject });
  ws.send(JSON.stringify({ id: myId, method, params }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 420, height: 980, deviceScaleFactor: 1, mobile: false });

const variants = [
  ["base", ""],
  ["session-menu", "?open=session"],
  ["model-menu", "?open=model"],
  ["tabs", "?view=tabs"],
];
fs.mkdirSync(outDir, { recursive: true });
for (const [name, qs] of variants) {
  await send("Page.navigate", { url: baseUrl + qs });
  await sleep(1400);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const file = path.join(outDir, `p-${name}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
  console.log("wrote", file, Buffer.from(shot.data, "base64").length);
}
ws.close();
