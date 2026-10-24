// DSH Edge Bridge — MV3 service worker
// 出站 WebSocket 连到本地桥接（默认 ws://127.0.0.1:8766/ws），充当 CDP 执行器。
// 消息形状对齐 Playwright MCP Bridge：请求 {id,method,params} / 响应 {id,result|error} / 通知 {method,params}。
// 本文件不含任何智能：只执行命令、渲染侧边栏、转发事件。大脑在 DeepSeek Harness 侧。

const DEFAULT_URL = "ws://127.0.0.1:8766/ws";
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30000;

let ws = null;
let config = { url: DEFAULT_URL, token: "" };
let installId = "";
let backoffMs = RECONNECT_MIN_MS;
let reconnectTimer = null;
let userDisconnected = false;
let nextId = 1;
const ports = new Set(); // 侧边栏/设置页的长连接

// ---------- 侧边栏/设置页通信 ----------

function notifyPorts(msg) {
  for (const p of ports) {
    try { p.postMessage(msg); } catch {}
  }
}

function currentStatus() {
  return {
    type: "status",
    connected: !!(ws && ws.readyState === 1),
    url: config.url,
    version: chrome.runtime.getManifest().version,
  };
}

async function pushTabsToPort(port) {
  try {
    const tabs = await chrome.tabs.query({});
    const list = tabs.map((t) => ({
      tabId: t.id, index: t.index, active: t.active,
      title: t.title || "", url: t.url || "", windowId: t.windowId,
    }));
    const msg = { type: "tabs", tabs: list };
    if (port) { try { port.postMessage(msg); } catch {} }
    else notifyPorts(msg);
  } catch {}
}

async function pushEngineToPort(port) {
  try {
    const r = await bridgeCall("sessionStatus", {});
    const msg = { type: "engine", engine: r };
    if (port) { try { port.postMessage(msg); } catch {} }
    else notifyPorts(msg);
  } catch {}
}

chrome.runtime.onConnect.addListener((port) => {
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  port.postMessage(currentStatus());
  if (port.name === "sidepanel") {
    pushTabsToPort(port);
    pushEngineToPort(port);
  }
  port.onMessage.addListener(async (m) => {
    if (!m || typeof m !== "object") return;
    if (m.type === "getTabs") pushTabsToPort(port);
    if (m.type === "getEngine") pushEngineToPort(port);
    if (m.type === "say" && typeof m.text === "string") {
      try {
        const r = await bridgeCall("sessionSay", { text: m.text });
        port.postMessage({ type: "sayOk", ...r });
        pushEngineToPort(port);
      } catch (e) {
        port.postMessage({ type: "sayError", error: String((e && e.message) || e) });
      }
    }
    if (m.type === "loadEvents") {
      try {
        const r = await bridgeCall("sessionEvents", { since: Number(m.since || 0) });
        port.postMessage({ type: "events", ...r });
      } catch (e) {
        port.postMessage({ type: "eventsError", error: String((e && e.message) || e) });
      }
    }
    // ---- 真实会话（与 DSH 双向同步）----
    if (m.type === "getSessions") {
      try {
        const r = await bridgeCall("sessions", { refresh: !!m.refresh });
        port.postMessage({ type: "sessions", ...r });
      } catch (e) {
        port.postMessage({ type: "sessionsError", error: String((e && e.message) || e) });
      }
    }
    if (m.type === "selectSession" && typeof m.id === "string" && m.id) {
      try {
        const r = await bridgeCall("sessionSelect", { id: m.id }, 20000);
        port.postMessage({ type: "sessions", sessions: (await bridgeCall("sessions", {})).sessions, current: r.sessionId });
        pushEngineToPort(port);
      } catch (e) {
        port.postMessage({ type: "sessionsError", error: String((e && e.message) || e) });
      }
    }
    if (m.type === "newSession") {
      try {
        const r = await bridgeCall("sessionNew", {});
        port.postMessage({ type: "sessions", sessions: (await bridgeCall("sessions", {})).sessions, current: r.sessionId });
        pushEngineToPort(port);
      } catch (e) {
        port.postMessage({ type: "sessionsError", error: String((e && e.message) || e) });
      }
    }
    // ---- 模型切换（无头引擎使用）----
    if (m.type === "getModels") {
      try {
        const r = await bridgeCall("models", {});
        port.postMessage({ type: "models", ...r });
      } catch {}
    }
    if (m.type === "setModel" && typeof m.model === "string" && m.model) {
      try {
        const r = await bridgeCall("setModel", { model: m.model }, 20000);
        port.postMessage({ type: "models", ...r });
        pushEngineToPort(port);
      } catch (e) {
        port.postMessage({ type: "sayError", error: String((e && e.message) || e) });
      }
    }
    if (m.type === "reconnect") { userDisconnected = false; await init(); }
    if (m.type === "disconnect") { userDisconnected = true; clearTimeout(reconnectTimer); closeWs(); setBadge("off"); }
    if (m.type === "activate" && Number.isFinite(m.tabId)) {
      try {
        const t = await chrome.tabs.update(m.tabId, { active: true });
        await chrome.windows.update(t.windowId, { focused: true });
      } catch {}
    }
  });
});

chrome.runtime.onMessage.addListener((m, _sender, sendResponse) => {
  if (m && m.type === "configSaved") {
    sendResponse({ ok: true });
    init();
  }
  if (m && m.type === "getStatus") sendResponse(currentStatus());
  return false;
});

// ---------- 图标角标 ----------

function setBadge(state) {
  const map = {
    on: { text: "●", color: "#22c55e" },
    off: { text: "○", color: "#94a3b8" },
    err: { text: "!", color: "#ef4444" },
  };
  const s = map[state] || map.off;
  try {
    chrome.action.setBadgeText({ text: s.text });
    chrome.action.setBadgeBackgroundColor({ color: s.color });
  } catch {}
  notifyPorts(currentStatus());
}

// ---------- WebSocket 连接 ----------

async function loadConfig() {
  const stored = await chrome.storage.local.get(["bridgeUrl", "bridgeToken", "installId"]);
  config = {
    url: stored.bridgeUrl || DEFAULT_URL,
    token: stored.bridgeToken || "",
  };
  // 每个扩展安装一个稳定 id：桥接据此判断"同一个浏览器重连"还是"另一个浏览器"
  installId = stored.installId || "";
  if (!installId) {
    try {
      installId = (typeof crypto !== "undefined" && crypto.randomUUID)
        ? crypto.randomUUID()
        : "inst-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
      await chrome.storage.local.set({ installId });
    } catch {
      installId = "inst-" + Date.now().toString(36);
    }
  }
}

function closeWs() {
  if (ws) {
    const s = ws;
    ws = null;
    try { s.onclose = null; s.close(); } catch {}
  }
}

function scheduleReconnect() {
  if (userDisconnected) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => connect(), backoffMs);
  backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS);
}

function connect() {
  if (userDisconnected) return;
  clearTimeout(reconnectTimer);
  closeWs();
  let sock;
  try { sock = new WebSocket(config.url); } catch { setBadge("err"); scheduleReconnect(); return; }
  ws = sock;
  sock.onopen = () => {
    backoffMs = RECONNECT_MIN_MS;
    setBadge("on");
    send({
      id: nextId++,
      method: "hello",
      params: {
        token: config.token,
        installId,
        extVersion: chrome.runtime.getManifest().version,
        userAgent: navigator.userAgent,
      },
    });
    notifyPorts(currentStatus());
    pushEngineToPort(null);
  };
  sock.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleFrame(msg);
  };
  sock.onclose = () => {
    if (ws === sock) ws = null;
    setBadge("off");
    scheduleReconnect();
  };
  sock.onerror = () => { /* onclose 随后触发 */ };
}

function send(obj) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch {}
  }
}

// 扩展主动请求桥接（会话联动）：请求-响应配对
const pendingBridgeCalls = new Map();
function bridgeCall(method, params = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== 1) { reject(new Error("桥接未连接")); return; }
    const id = nextId++;
    const timer = setTimeout(() => {
      pendingBridgeCalls.delete(id);
      reject(new Error(method + " timeout"));
    }, timeoutMs);
    pendingBridgeCalls.set(id, { resolve, reject, timer });
    send({ id, method, params });
  });
}

async function handleFrame(msg) {
  // 桥接对我们请求的响应
  if (msg && msg.id != null && !msg.method && (msg.result !== undefined || msg.error !== undefined)) {
    const p = pendingBridgeCalls.get(msg.id);
    if (p) {
      pendingBridgeCalls.delete(msg.id);
      clearTimeout(p.timer);
      msg.error !== undefined ? p.reject(new Error(String(msg.error))) : p.resolve(msg.result);
    }
    return;
  }
  // 桥接发来的请求（带 id）
  if (msg && msg.id != null && msg.method) {
    try {
      const result = await handleCommand(msg.method, msg.params || {});
      send({ id: msg.id, result });
    } catch (e) {
      send({ id: msg.id, error: String((e && e.message) || e) });
    }
    return;
  }
  // 桥接推送：会话事件 → 转发侧边栏
  if (msg && msg.method === "session") {
    notifyPorts({ type: "session", event: msg.params && msg.params.event });
    return;
  }
  // 桥接推送：切换会话 → 让侧边栏清空并重载历史
  if (msg && msg.method === "sessionReset") {
    notifyPorts({ type: "reset" });
    return;
  }
  if (msg && msg.method === "reconnect") connect();
}

// ---------- 命令实现（桥接 → 扩展） ----------

function normalizeUrl(u) {
  if (!u) return "about:blank";
  if (/^(https?|file|data|about:blank|edge|chrome)/i.test(u)) return u;
  return "https://" + u;
}

const alreadyAttached = (e) => /already attached/i.test(String((e && e.message) || e));

const handlers = {
  async ping() { return { pong: true, t: Date.now() }; },

  async listTabs() {
    const tabs = await chrome.tabs.query({});
    return tabs.map((t) => ({
      tabId: t.id, index: t.index, windowId: t.windowId, active: t.active,
      title: t.title || "", url: t.url || "", favIconUrl: t.favIconUrl || "",
    }));
  },

  async newTab(p) {
    const t = await chrome.tabs.create({ url: normalizeUrl(p.url), active: p.active !== false });
    return { tabId: t.id, url: t.url || p.url, title: t.title || "" };
  },

  async activateTab(p) {
    const t = await chrome.tabs.update(p.tabId, { active: true });
    try {
      const w = await chrome.windows.get(t.windowId);
      // 最小化的窗口没有合成帧（截图会挂起），先恢复
      if (w.state === "minimized") await chrome.windows.update(t.windowId, { state: "normal", focused: true });
      else await chrome.windows.update(t.windowId, { focused: true });
    } catch {}
    return { ok: true };
  },

  async closeTab(p) {
    await chrome.tabs.remove(p.tabId);
    return { ok: true };
  },

  async navigate(p) {
    const t = await chrome.tabs.update(p.tabId, { url: normalizeUrl(p.url) });
    return { tabId: t.id, url: t.url || p.url };
  },

  async attachToTab(p) {
    try {
      await chrome.debugger.attach({ tabId: p.tabId }, "1.3");
    } catch (e) {
      if (!alreadyAttached(e)) throw e;
    }
    return { targetId: String(p.tabId), attached: true };
  },

  async detachTab(p) {
    try { await chrome.debugger.detach({ tabId: p.tabId }); } catch {}
    return { ok: true };
  },

  // CDP 直通：桥接 /tabs/{id}/cdp 的落点
  async cdpCommand(p) {
    return await chrome.debugger.sendCommand({ tabId: p.tabId }, p.method, p.params || {});
  },
};

async function handleCommand(method, params) {
  const fn = handlers[method];
  if (!fn) throw new Error("unknown method: " + method);
  return await fn(params);
}

// ---------- debugger / tabs 事件转发 ----------

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (source == null || source.tabId == null) return;
  send({ method: "cdpEvent", params: { tabId: source.tabId, method, params: params || {} } });
});

chrome.debugger.onDetach.addListener((source, reason) => {
  const tabId = source && source.tabId;
  send({ method: "debuggerDetached", params: { tabId, reason: reason || "" } });
});

let tabsNotifyTimer = null;
function queueTabsChanged() {
  if (tabsNotifyTimer) return;
  tabsNotifyTimer = setTimeout(() => {
    tabsNotifyTimer = null;
    send({ method: "tabsChanged", params: {} });
    pushTabsToPort(null);
  }, 400);
}

chrome.tabs.onCreated.addListener(queueTabsChanged);
chrome.tabs.onRemoved.addListener(queueTabsChanged);
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "complete" || info.url || info.title) queueTabsChanged();
});

// ---------- 保活：WS 流量 + alarm 兜底唤醒 ----------

chrome.alarms.create("dsh-ka", { periodInMinutes: 0.4 }); // ~24s
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name !== "dsh-ka") return;
  if (!ws || ws.readyState !== 1) connect();
  else send({ method: "ka", params: { t: Date.now() } });
});

// 点击工具栏图标 → 打开侧边栏
try {
  chrome.sidePanel &&
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
} catch {}

// ---------- 启动 ----------

async function init() {
  await loadConfig();
  connect();
}

chrome.runtime.onInstalled.addListener(() => { init(); });
chrome.runtime.onStartup.addListener(() => { init(); });
init();
