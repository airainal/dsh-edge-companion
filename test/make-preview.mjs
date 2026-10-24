// 生成侧边栏渲染预览页：直接使用真实的 sidepanel.html / sidepanel.css / sidepanel.js，
// 只注入一段模拟 chrome API + 假数据。用于在普通标签页里可视验收 UI（不依赖扩展上下文）。
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".");
const outFile = path.join(root, "test", "sidepanel-preview.html");
const html = fs.readFileSync(path.join(root, "extension", "sidepanel.html"), "utf8");
const css = fs.readFileSync(path.join(root, "extension", "sidepanel.css"), "utf8");
const js = fs.readFileSync(path.join(root, "extension", "sidepanel.js"), "utf8");

let events = [];
for (const file of [path.join(root, "bridge", "session-log.jsonl"), path.join(root, "test", "sample-session-log.jsonl")]) {
  try {
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    events = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).slice(-18);
    if (events.length) break;
  } catch {}
}
events = events.map((e) => ({ ...e, text: e.text ? String(e.text).slice(0, 700) : e.text }));

const now = Date.now();
const sessions = [
  { id: "session-28ec2c2c-561c-44d0-a10f-3587df5e7f37", title: "打开 example.net 并回答页面标题", updatedAt: now - 3600e3, current: true },
  { id: "session-9e0a86f5-d438-4ea9-a38c-3153018c34fb", title: "在拼题A 上作答并逐题验证", updatedAt: now - 7200e3, current: false },
  { id: "session-bf88e471-1040-42c5-9b60-76ceec8b7640", title: "调研 CDP 截图被遮挡问题", updatedAt: now - 86400e3, current: false },
];
const models = [
  { id: "deepseek-flash", label: "DeepSeek-V4.1-Flash" },
  { id: "deepseek-v4-pro", label: "DeepSeek-V4-Pro" },
];
const tabs = [
  { tabId: 1967531527, index: 0, active: false, title: "Example Domain", url: "https://example.com/" },
  { tabId: 1967531530, index: 1, active: true, title: "DSH Edge Bridge 自测页", url: "file:///…/fixture-quiz.html" },
];
const engine = {
  mode: "dsh", model: "deepseek-flash", configuredModel: "deepseek-flash",
  provider: "deepseek-account", models, worker: { running: false },
  session: { sessionId: sessions[0].id, title: sessions[0].title, located: true },
};

const stub = `
(function () {
  const EVENTS = ${JSON.stringify(events)};
  const TABS = ${JSON.stringify(tabs)};
  const SESSIONS = ${JSON.stringify(sessions)};
  const MODELS = ${JSON.stringify(models)};
  const ENGINE = ${JSON.stringify(engine)};
  const listeners = [];
  function dispatch(m) { for (const fn of listeners) fn(m); }
  const fakePort = {
    onMessage: { addListener(fn) { listeners.push(fn); } },
    postMessage(msg) {
      switch (msg.type) {
        case "loadEvents": setTimeout(() => dispatch({ type: "events", events: EVENTS, now: EVENTS.length }), 10); break;
        case "getTabs": setTimeout(() => dispatch({ type: "tabs", tabs: TABS }), 10); break;
        case "getEngine": setTimeout(() => dispatch({ type: "engine", engine: ENGINE }), 10); break;
        case "getModels": setTimeout(() => dispatch({ type: "models", provider: "deepseek-account", selected: MODELS[0].id, models: MODELS }), 10); break;
        case "getSessions": setTimeout(() => dispatch({ type: "sessions", sessions: SESSIONS, current: SESSIONS[0].id }), 10); break;
        default: break;
      }
    },
  };
  window.chrome = { runtime: { connect: () => fakePort, openOptionsPage() {} } };
  setTimeout(() => dispatch({ type: "status", connected: true }), 5);
  // 便于截图：?open=session|model 自动展开下拉；?view=tabs 切到标签页
  setTimeout(() => {
    const q = new URLSearchParams(location.search);
    if (q.get("view") === "tabs") { const b = document.getElementById("view-tabs"); if (b) b.click(); }
    const which = q.get("open");
    if (which) { const b = document.getElementById(which + "-btn"); if (b) b.click(); }
  }, 500);
})();
`;

const out = html
  .replace('<link rel="stylesheet" href="sidepanel.css" />', `<style>\n${css}\n</style>`)
  .replace('<script src="sidepanel.js"></script>', `<script>\n${stub}\n</script>\n<script>\n${js}\n</script>`);
fs.writeFileSync(outFile, out);
console.log(JSON.stringify({ outFile, events: events.length }, null, 1));
