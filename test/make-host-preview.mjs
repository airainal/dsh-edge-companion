import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".");
const html = fs.readFileSync(path.join(root, "extension", "sidepanel.html"), "utf8");
const css = fs.readFileSync(path.join(root, "extension", "sidepanel-1.3.2.css"), "utf8");
const js = fs.readFileSync(path.join(root, "extension", "sidepanel-1.3.2.js"), "utf8");
const body = html.match(/<body>([\s\S]*?)<\/body>/)[1].replace(/<script[\s\S]*?<\/script>/g, "");

const mk = (text) => ({ text, chunks: text.match(/.{1,6}/gs) || [text] });
const thinking = mk("先确认客户端会话是同一个 Agent；然后直接在桌面会话里打开页面并读取标题。");
const answer = mk("页面标题是 Example Domain。这个会话与 DSH 客户端是同一个，Codex 模式、权限和上下文都一致。");

const events = [
  { seq: 1, kind: "user", text: "打开 example.com，告诉我页面标题。" },
  { seq: 2, kind: "system", text: "⚡ 已发送到 DSH 客户端同一会话（实时同步）" },
  ...thinking.chunks.map((text, i) => ({ seq: 3 + i, kind: "thinking_delta", streamId: "demo", text })),
  ...answer.chunks.map((text, i) => ({ seq: 20 + i, kind: "assistant_delta", streamId: "demo", text })),
  { seq: 60, kind: "assistant_final", streamId: "demo", text: answer.text },
];

const reasoning = {
  defaultEffort: "high",
  efforts: [
    { id: "off", name: "Off" },
    { id: "low", name: "Low" },
    { id: "high", name: "High" },
    { id: "max", name: "Max" },
  ],
};
const engine = {
  mode: "dsh",
  host: { connected: true, running: true, codex: true },
  session: { sessionId: "session-demo-edge-codex", title: "Codex 模式 · Edge 联调", located: true },
  models: [
    { id: "deepseek-flash", label: "DeepSeek-V4.1-Flash", provider: "deepseek-account", providerName: "DeepSeek Account", reasoning },
    { id: "deepseek-v4-pro", label: "DeepSeek-V4-Pro", provider: "deepseek-account", providerName: "DeepSeek Account", reasoning },
    { id: "glm-5.3", label: "GLM-5.3", provider: "zai-coding-cn", providerName: "zai-coding-cn", reasoning: { efforts: [{ id: "off", name: "Off" }, { id: "high", name: "High" }] } },
    { id: "glm-5.3-flash", label: "GLM-5.3-Flash", provider: "zai-coding-cn", providerName: "zai-coding-cn", reasoning: { efforts: [{ id: "off", name: "Off" }, { id: "high", name: "High" }] } },
  ],
  modelCurrent: { provider: "deepseek-account", model: "deepseek-flash", reasoningEffort: "max" },
  configuredModel: "deepseek-flash",
  model: "deepseek-flash",
  provider: "deepseek-account",
  worker: { running: false },
};

const sessions = [
  { id: "session-demo-edge-codex", title: "Codex 模式 · Edge 联调", updatedAt: Date.now(), current: true },
  { id: "session-demo-old", title: "询问浏览器控制插件", updatedAt: Date.now() - 3600e3, current: false },
];

const stub = `<script>
(function () {
  const EVENTS = ${JSON.stringify(events)};
  const ENGINE = ${JSON.stringify(engine)};
  const SESSIONS = ${JSON.stringify(sessions)};
  const listeners = [];
  function dispatch(m) { for (const fn of listeners) fn(m); }
  let listenerCount = 0;
  window.__errs = [];
  window.addEventListener("error", (e) => window.__errs.push(String(e.message || e)));
  const fakePort = {
    onMessage: { addListener(fn) { listeners.push(fn); listenerCount = listeners.length; window.__listenerCount = listenerCount; } },
    onDisconnect: { addListener() {} },
    postMessage(msg) {
      switch (msg.type) {
        case "loadEvents": setTimeout(() => dispatch({ type: "events", events: [], now: 0 }), 5); break;
        case "getTabs": setTimeout(() => dispatch({ type: "tabs", tabs: [] }), 5); break;
        case "getEngine": setTimeout(() => dispatch({ type: "engine", engine: ENGINE }), 5); break;
        case "getModels": setTimeout(() => dispatch({ type: "models", provider: "deepseek-account", selected: "deepseek-flash", current: ENGINE.modelCurrent, models: ENGINE.models }), 5); break;
        case "getSessions": setTimeout(() => dispatch({ type: "sessions", sessions: SESSIONS, current: SESSIONS[0].id }), 5); break;
        case "say": setTimeout(() => dispatch({ type: "sayOk" }), 5); break;
        default: break;
      }
    },
  };
  window.chrome = {
    runtime: { connect: () => fakePort, openOptionsPage() {}, getManifest: () => ({ version: "1.3.0" }) },
  };
  window.__dispatch = dispatch;
  window.__events = EVENTS;
})();
<\/script>`;

const boot = `<script>
const q = new URLSearchParams(location.search);
const isRunning = q.get("state") !== "done";
setTimeout(() => {
  try {
    __dispatch({ type: "status", connected: true, host: true, running: isRunning, codex: true });
  } catch (e) { window.__errs.push("status: " + e.message); }
  try {
    __dispatch({ type: "engine", engine: { ...${JSON.stringify(engine)}, host: { connected: true, running: isRunning, codex: true } } });
  } catch (e) { window.__errs.push("engine: " + e.message); }
  try {
    __dispatch({ type: "models", selected: "deepseek-flash", models: ${JSON.stringify(engine.models)} });
    __dispatch({ type: "sessions", sessions: ${JSON.stringify(sessions)}, current: ${JSON.stringify(sessions[0].id)} });
  } catch (e) { window.__errs.push("lists: " + e.message); }
  let t = 30;
  const stream = isRunning
    ? __events.filter((ev) => ev.kind !== "assistant_final" && ev.kind !== "stream_end")
    : __events;
  for (const ev of stream) {
    setTimeout(() => { try { __dispatch({ type: "session", event: ev }); } catch (e) { window.__errs.push("event: " + e.message); } }, t);
    t += 22;
  }
  if (isRunning) setTimeout(() => __dispatch({ type: "status", connected: true, running: true, host: true, codex: true }), t + 50);
  else setTimeout(() => __dispatch({ type: "status", connected: true, running: false, host: true, codex: true }), t + 50);
}, 120);
<\/script>`;

const out = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><style>${css}</style></head><body>${body}${stub}<script>${js}<\/script>${boot}</body></html>`;
fs.writeFileSync(path.join(root, "test", "host-preview.html"), out);
console.log("wrote test/host-preview.html", out.length);
