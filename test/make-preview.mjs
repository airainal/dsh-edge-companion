// 生成侧边栏渲染预览页：直接使用真实的 sidepanel.html / sidepanel.css / sidepanel.js，
// 只注入一段模拟 chrome API + 假数据。用于在普通标签页里可视验收 UI（不依赖扩展上下文）。
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".");
const outFile = path.join(root, "test", "sidepanel-preview.html");
const html = fs.readFileSync(path.join(root, "extension", "sidepanel.html"), "utf8");
// 静态资源带版本号（sidepanel-1.3.3.css/js），从 HTML 里解析真实文件名，避免脚本与页面漂移。
const cssHref = (html.match(/<link\s+rel="stylesheet"\s+href="([^"]+)"/) || [])[1] || "sidepanel.css";
const jsSrc = (html.match(/<script\s+src="([^"]+)"><\/script>/) || [])[1] || "sidepanel.js";
const css = fs.readFileSync(path.join(root, "extension", cssHref), "utf8");
const js = fs.readFileSync(path.join(root, "extension", jsSrc), "utf8");

let events = [];
for (const file of [path.join(root, "bridge", "session-log.jsonl"), path.join(root, "test", "sample-session-log.jsonl")]) {
  try {
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    events = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).slice(-18);
    if (events.length) break;
  } catch {}
}
events = events.map((e) => ({ ...e, text: e.text ? String(e.text).slice(0, 700) : e.text }));
// 历史分页需要一个够长的样本：不足 120 条时用确定性合成数据补齐（上拉分页验收用）。
if (events.length < 100) {
  const synth = [];
  for (let i = 1; i <= 120; i++) {
    synth.push(i % 2
      ? { seq: i, kind: "user", text: `第 ${Math.ceil(i / 2)} 条历史指令（分页测试）` }
      : { seq: i, kind: "assistant", text: `第 ${Math.ceil(i / 2)} 条历史回复：用于验证上拉分页与滚动位置的占位内容。` });
  }
  events = synth;
} else {
  events = events.slice(-120);
}

const now = Date.now();
const sessions = [
  { id: "session-28ec2c2c-561c-44d0-a10f-3587df5e7f37", title: "打开 example.net 并回答页面标题", updatedAt: now - 3600e3, current: true },
  { id: "session-9e0a86f5-d438-4ea9-a38c-3153018c34fb", title: "在拼题A 上作答并逐题验证", updatedAt: now - 7200e3, current: false },
  { id: "session-bf88e471-1040-42c5-9b60-76ceec8b7640", title: "调研 CDP 截图被遮挡问题", updatedAt: now - 86400e3, current: false },
];
const reasoning = { defaultEffort: "high", efforts: [{ id: "off", name: "Off" }, { id: "low", name: "Low" }, { id: "high", name: "High" }, { id: "max", name: "Max" }] };
const models = [
  { id: "deepseek-flash", label: "DeepSeek-V4.1-Flash", provider: "deepseek-account", providerName: "DeepSeek Account", reasoning },
  { id: "deepseek-v4-pro", label: "DeepSeek-V4-Pro", provider: "deepseek-account", providerName: "DeepSeek Account", reasoning },
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
  window.__dispatch = dispatch; // 验收脚本可以注入 status/engine 帧
  const fakePort = {
    onMessage: { addListener(fn) { listeners.push(fn); } },
    onDisconnect: { addListener() {} },
    postMessage(msg) {
      window.__sent = window.__sent || [];
      window.__sent.push(msg);
      if (msg.type === "say") setTimeout(() => dispatch({ type: "sayOk", ok: true }), 10);
      switch (msg.type) {
        case "loadEvents": {
          const tail = Math.max(1, Number(msg.tail || 30));
          const start = Math.max(0, EVENTS.length - tail);
          setTimeout(() => dispatch({
            type: "events",
            events: EVENTS.slice(start),
            total: EVENTS.length,
            hasMore: start > 0,
            older: msg.older === true,
            tail,
          }), 10);
          break;
        }
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
  .replace(/<link\s+rel="stylesheet"\s+href="[^"]+"\s*\/?>/, `<style>\n${css}\n</style>`)
  .replace(/<script\s+src="[^"]+"><\/script>/, `<script>\n${stub}\n</script>\n<script>\n${js}\n</script>`);
fs.writeFileSync(outFile, out);
console.log(JSON.stringify({ outFile, cssHref, jsSrc, events: events.length }, null, 1));
