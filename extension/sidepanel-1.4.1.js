// 侧边栏：DSH 会话镜像（查看进展 + 下达指令）+ 会话选择 / 新建 + 模型切换 + 标签页列表。
// 这里没有任何智能：只渲染桥接推来的事件、把输入送回桥接。
let port = null;
const $ = (id) => document.getElementById(id);
const pendingEl = () => $("pending");

let lastSeq = 0;
let connected = false;
let lastToolBody = null;   // 待配对结果的工具折叠块
let lastToolSummary = null;
let currentSessionId = null;
let sessionTitle = "";
let currentModel = "";
let currentProvider = "";
let currentEffort = "";
let models = [];
let running = false;
const liveStreams = new Map(); // streamId -> { textEl, thinkEl }

// ---------- 视图切换（横向滑动） ----------
$("view-chat").addEventListener("click", () => switchView("chat"));
$("view-tabs").addEventListener("click", () => switchView("tabs"));
function switchView(v) {
  const chat = v === "chat";
  $("views").classList.toggle("show-tabs", !chat);
  $("view-chat").className = "seg-btn" + (chat ? " active" : "");
  $("view-tabs").className = "seg-btn" + (chat ? "" : " active");
  closeMenus();
  if (chat) refreshSessions(false);
}

// ---------- 自定义下拉（浮层 + 动画） ----------
function closeMenus(except) {
  for (const dd of document.querySelectorAll(".dd.open")) {
    if (dd === except) continue;
    dd.classList.remove("open");
    const btn = dd.querySelector(".dd-btn");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }
}
document.addEventListener("click", (e) => {
  if (!e.target.closest(".dd")) closeMenus();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeMenus();
});
function bindDropdown(ddId, btnId) {
  const dd = $(ddId);
  const btn = $(btnId);
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = !dd.classList.contains("open");
    closeMenus(dd);
    dd.classList.toggle("open", willOpen);
    btn.setAttribute("aria-expanded", String(willOpen));
  });
}

// ---------- 连接状态 ----------
const SEND_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M6.5 10.5 12 5l5.5 5.5" /></svg>';
const STOP_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.5" y="4.5" width="7" height="7" rx="1.2" /></svg>';

function updateSendButton() {
  const b = $("btn-send");
  if (!b) return;
  b.classList.toggle("stop", running);
  b.title = running ? "停止当前会话" : "发送";
  b.setAttribute("aria-label", running ? "停止当前会话" : "发送");
  b.innerHTML = running ? STOP_ICON : SEND_ICON;
}

function setRunning(next) {
  running = !!next;
  workerRunning = running;
  if (running) lastEventAt = Date.now();
  updateSendButton();
  if (running) {
    pendingEl().textContent = "DSH 正在执行…";
    pendingEl().classList.remove("hidden");
  } else {
    pendingEl().classList.remove("running");
    if (!lastUserSeq) pendingEl().classList.add("hidden");
  }
}

let disconnectTimer = null;
let zcodeWarned = false;

function applyConnectionState(next) {
  connected = !!next;
  $("dot").classList.toggle("on", connected);
  updateBanner();
  updateDisabled();
}

function renderStatus(m) {
  const isConn = m.connected === true;
  // 桥接重连往往只有几百毫秒：先不认断线，避免横幅/输入框闪一下。
  // 恢复则立刻生效。
  if (isConn) {
    if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; }
    applyConnectionState(true);
  } else if (!disconnectTimer) {
    if (connected) {
      disconnectTimer = setTimeout(() => { disconnectTimer = null; applyConnectionState(false); }, 1200);
    } else {
      applyConnectionState(false);
    }
  }
  if (typeof m.running === "boolean") setRunning(m.running);
  const warnings = m.warnings || {};
  if (warnings.zcodeBridge && !zcodeWarned) {
    zcodeWarned = true;
    const d = document.createElement("div");
    d.className = "sysline warn";
    d.textContent = "⚠ 检测到 ZCode 桥接（127.0.0.1:8765）同时运行：两套扩展会抢同一标签页的调试会话，任务可能卡住。建议在 edge://extensions 停用 “ZCode Edge Bridge”。";
    $("chat").appendChild(d);
    scrollBottom();
  }
}
function updateBanner() {
  const b = $("banner");
  if (connected) { b.classList.add("hidden"); return; }
  b.classList.remove("hidden");
  b.innerHTML =
    '<div class="banner-title">⟳ 桥接未连接（正在自动重连…）</div>' +
    '<div class="banner-actions">' +
      '<a class="pill-btn" href="dshedge://start" target="_blank" rel="noopener">启动桥接</a>' +
      '<a class="pill-btn ghost" href="dshedge://open" target="_blank" rel="noopener">启动并打开 DSH</a>' +
    '</div>' +
    '<div class="banner-sub">点「启动桥接」即可（首次点击若弹出确认窗，选「打开」）。若按钮无效，双击 bridge\\start-bridge.cmd。</div>';
}
function updateDisabled() {
  const off = !connected;
  $("input").disabled = off;
  $("btn-send").disabled = off;
  $("session-btn").disabled = off;
  $("btn-new-session").disabled = off;
  $("model-btn").disabled = off || !models.length;
}

// ---------- 引擎标签 / 模型 ----------
function renderEngine(e) {
  const el = $("engine");
  if (!e) { el.classList.add("hidden"); return; }
  const host = e.host || {};
  if (host.connected) {
    el.textContent = host.codex ? "DSH · Codex" : "DSH";
    el.title = "侧边栏直接驱动 DSH 客户端里的同一会话，实时同步对话、思考与停止状态";
    el.classList.toggle("live", !!host.running);
    setRunning(!!host.running);
  } else {
    const mode = e.mode === "dsh" ? "DSH" : "队列";
    const model = (e.model || "").replace(/^deepseek-/, "");
    el.textContent = mode + (model ? " · " + model : "");
    el.title = e.mode === "dsh"
      ? "侧边栏指令会自动唤醒 DSH headless 执行（模型：" + (e.provider || "?") + "/" + (e.model || "?") + "）"
      : "队列模式：指令排队，等你当前的 DSH 会话领取";
    el.classList.toggle("live", !!e.worker && e.worker.running);
    setRunning(!!e.worker && e.worker.running);
  }
  el.classList.remove("hidden");
  if (e.session) {
    currentSessionId = e.session.sessionId || null;
    if (e.session.title) sessionTitle = e.session.title;
    const hint = e.session.sessionId
      ? "已连接 DSH 会话" + (e.session.title ? "「" + e.session.title + "」" : "")
      : "新会话（下条指令创建）";
    $("session-hint").textContent = hint;
    $("session-hint").title = e.session.sessionId || "";
    $("session-label").textContent = e.session.sessionId ? (sessionTitle || "新会话") : "＋ 新会话";
  }
  if (Array.isArray(e.models) && e.models.length) {
    renderModels({ models: e.models, current: e.modelCurrent, provider: e.provider, selected: e.model });
  }
}

function modelMatches(item) {
  return item && item.id === currentModel && (!currentProvider || !item.provider || item.provider === currentProvider);
}

function effortName(item, id) {
  if (!item || !item.reasoning || !id) return "";
  const hit = (item.reasoning.efforts || []).find((e) => e.id === id);
  return hit ? (hit.name || hit.id) : id;
}

function displayProvider(item) {
  const raw = item.providerName || item.provider || "";
  return raw === "DeepSeek Account" ? "DeepSeek 账号" : raw;
}

let pickerPage = "root";

function setPickerPage(page) {
  pickerPage = page;
  $("picker-root").classList.toggle("hidden", page !== "root");
  $("picker-models").classList.toggle("hidden", page !== "models");
  $("picker-efforts").classList.toggle("hidden", page !== "efforts");
}

function renderModels(m) {
  if (!m || !Array.isArray(m.models)) return;
  models = m.models;
  const cur = m.current;
  if (cur && cur.model) {
    currentProvider = cur.provider || "";
    currentModel = cur.model;
    currentEffort = cur.reasoningEffort || "";
  } else {
    if (m.provider) currentProvider = m.provider;
    if (m.selected) currentModel = m.selected;
  }

  const curItem = models.find(modelMatches);
  const efforts = curItem && curItem.reasoning && Array.isArray(curItem.reasoning.efforts) ? curItem.reasoning.efforts : [];
  const effective = currentEffort || (curItem && curItem.reasoning && curItem.reasoning.defaultEffort) || "";
  const effectiveName = effortName(curItem, effective);
  const modelName = curItem ? (curItem.label || curItem.id) : (currentModel || "模型");

  // trigger: model + effort, like the client composer
  $("model-label").textContent = modelName;
  $("model-btn").title = modelName + (effectiveName ? " · " + effectiveName : "");
  const effortEl = $("effort-label");
  effortEl.textContent = effectiveName;
  effortEl.classList.toggle("hidden", !effectiveName);

  // root rows
  $("pick-model-value").textContent = modelName;
  $("pick-effort-value").textContent = effectiveName || "默认";
  $("pick-effort").classList.toggle("hidden", !efforts.length);

  // grouped model list
  const groups = [];
  const byProvider = new Map();
  for (const item of models) {
    const key = item.provider || "";
    if (!byProvider.has(key)) {
      const group = { id: key, name: displayProvider(item), models: [] };
      byProvider.set(key, group);
      groups.push(group);
    }
    byProvider.get(key).models.push(item);
  }
  const groupHost = $("model-groups");
  groupHost.innerHTML = "";
  for (const group of groups) {
    if (group.name) {
      const title = document.createElement("div");
      title.className = "picker-group-title";
      title.textContent = group.name;
      groupHost.appendChild(title);
    }
    for (const item of group.models) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "picker-item" + (modelMatches(item) ? " current" : "");
      b.innerHTML = '<span class="t"></span><span class="check"></span>';
      b.querySelector(".t").textContent = item.label || item.id;
      b.title = item.description || item.label || item.id;
      b.querySelector(".check").textContent = modelMatches(item) ? "✓" : "";
      b.addEventListener("click", () => {
        closeMenus();
        currentProvider = item.provider || "";
        currentModel = item.id;
        currentEffort = (item.reasoning && item.reasoning.defaultEffort) || "";
        const msg = { type: "setModel", provider: item.provider, model: item.id };
        if (currentEffort) msg.reasoningEffort = currentEffort;
        port.postMessage(msg);
        renderModels({ models, current: { provider: currentProvider, model: currentModel, reasoningEffort: currentEffort } });
      });
      groupHost.appendChild(b);
    }
  }

  // reasoning efforts
  const effortHost = $("effort-list");
  effortHost.innerHTML = "";
  for (const effort of efforts) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "picker-item" + (effort.id === effective ? " current" : "");
    b.innerHTML = '<span class="t"></span><span class="check"></span>';
    b.querySelector(".t").textContent = effort.name || effort.id;
    b.title = effort.description || effort.name || effort.id;
    b.querySelector(".check").textContent = effort.id === effective ? "✓" : "";
    b.addEventListener("click", () => {
      closeMenus();
      currentEffort = effort.id;
      port.postMessage({
        type: "setModel",
        provider: curItem ? curItem.provider : currentProvider,
        model: curItem ? curItem.id : currentModel,
        reasoningEffort: effort.id,
      });
      renderModels({ models, current: { provider: currentProvider, model: currentModel, reasoningEffort: currentEffort } });
    });
    effortHost.appendChild(b);
  }

  updateDisabled();
}

// ---------- 会话列表 / 选择 ----------
function shortId(id) { return id && id.length > 16 ? id.slice(0, 16) + "…" : (id || ""); }

function sessionItem({ id, title, meta, current }) {
  const b = document.createElement("button");
  b.type = "button";
  b.setAttribute("role", "option");
  b.className = "dd-item" + (current ? " current" : "");
  b.innerHTML = '<span class="t"></span><span class="meta"></span><span class="check"></span>';
  b.querySelector(".t").textContent = title;
  b.querySelector(".meta").textContent = meta || "";
  b.querySelector(".check").textContent = current ? "✓" : "";
  b.addEventListener("click", () => {
    closeMenus();
    if (id) port.postMessage({ type: "selectSession", id });
    else port.postMessage({ type: "newSession" });
  });
  return b;
}

function renderSessions(m) {
  const list = (m && m.sessions) || [];
  currentSessionId = (m && m.current) || null;
  const menu = $("session-menu");
  menu.innerHTML = "";
  menu.appendChild(sessionItem({ id: "", title: "＋ 新会话", meta: "", current: !currentSessionId }));
  for (const s of list) {
    const when = s.updatedAt
      ? new Date(s.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "";
    menu.appendChild(sessionItem({ id: s.id, title: s.title || "新会话", meta: when, current: s.id === currentSessionId }));
  }
  const hit = list.find((s) => s.id === currentSessionId);
  sessionTitle = hit ? (hit.title || "") : "";
  $("session-label").textContent = currentSessionId ? (sessionTitle || "新会话") : "＋ 新会话";
  $("session-hint").textContent = currentSessionId
    ? "当前会话：" + (sessionTitle || "新会话")
    : "新会话（下条指令创建）";
  updateDisabled();
}

function refreshSessions(refresh) { port.postMessage({ type: "getSessions", refresh: !!refresh }); }

bindDropdown("session-dd", "session-btn");
bindDropdown("model-dd", "model-btn");

// two-level picker: root -> model list / reasoning list
$("pick-model").addEventListener("click", () => setPickerPage("models"));
$("pick-effort").addEventListener("click", () => setPickerPage("efforts"));
$("picker-back-models").addEventListener("click", () => setPickerPage("root"));
$("picker-back-efforts").addEventListener("click", () => setPickerPage("root"));
$("model-btn").addEventListener("click", () => {
  setPickerPage("root");
  port.postMessage({ type: "getModels", refresh: true });
});
$("btn-new-session").addEventListener("click", () => { closeMenus(); port.postMessage({ type: "newSession" }); });

// ---------- 会话渲染 ----------
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function mdLite(s) {
  let t = esc(s);
  t = t.replace(/```([\s\S]*?)```/g, (_, code) => "<pre><code>" + code.replace(/^\n|\n$/g, "") + "</code></pre>");
  t = t.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>");
  t = t.replace(/(https?:\/\/[^\s<)"']+)/g, '<a href="$1" target="_blank">$1</a>');
  t = t.replace(/\n/g, "<br>");
  return t;
}

function nearBottom() {
  const c = $("chat");
  return c.scrollHeight - c.scrollTop - c.clientHeight < 90;
}
function scrollBottom() { $("chat").scrollTop = $("chat").scrollHeight; }

let lastUserSeq = 0;
let workerRunning = false;

// ---------- 历史分页（先加载最新一段，上拉再取更早） ----------
const HISTORY_PAGE = 30;
let historyWindow = HISTORY_PAGE;
let historyTotal = 0;
let historyHasMore = false;
let loadingOlder = false;
let lastEventAt = Date.now();

/** 用一批事件重画聊天区；preserve=true 时保持当前阅读位置（上拉加载更早）。 */
function renderHistory(events, { preserve = false } = {}) {
  const chat = $("chat");
  const prevHeight = preserve ? chat.scrollHeight : 0;
  const prevTop = preserve ? chat.scrollTop : 0;

  chat.innerHTML = "";
  lastSeq = 0;
  lastUserSeq = 0;
  workerRunning = false;
  running = false;
  liveStreams.clear();
  lastToolBody = null;
  lastToolSummary = null;
  $("pending").classList.add("hidden");

  const frag = document.createDocumentFragment();
  renderTarget = frag;
  try {
    if (!historyHasMore) {
      const cap = document.createElement("div");
      cap.className = "history-cap";
      cap.textContent = "— 会话开头 —";
      frag.appendChild(cap);
    }
    for (const ev of events || []) appendEvent(ev, { scroll: false });
  } finally {
    renderTarget = null;
  }
  chat.appendChild(frag);
  updateSendButton();
  lastEventAt = Date.now();
  if (preserve && prevHeight) chat.scrollTop = chat.scrollHeight - prevHeight + prevTop;
  else scrollBottom();
}

function requestOlderHistory() {
  const chat = $("chat");
  if (!historyHasMore || loadingOlder) return;
  if (historyTotal && historyWindow >= historyTotal) return;
  loadingOlder = true;
  historyWindow += HISTORY_PAGE;
  port.postMessage({ type: "loadEvents", tail: historyWindow, older: true });
}

function clearPendingIfAfter(seq) {
  if (lastUserSeq && seq > lastUserSeq && !workerRunning) {
    $("pending").classList.add("hidden");
    lastUserSeq = 0;
  }
}

function getLive(streamId) {
  let live = liveStreams.get(streamId);
  if (!live) {
    live = { textEl: null, bubble: null, thinkEl: null, thinkBody: null };
    liveStreams.set(streamId, live);
  }
  return live;
}

// 批量渲染历史时把事件写进离屏 fragment，避免逐条触发滚动/布局。
let renderTarget = null;
function appendEvent(ev, { scroll = true } = {}) {
  const chat = renderTarget || $("chat");
  if (renderTarget) scroll = false;
  lastEventAt = Date.now();
  const empty = chat.querySelector(".empty");
  if (empty) empty.remove();
  const stick = scroll && nearBottom();

  if (ev.kind === "user") {
    const d = document.createElement("div");
    d.className = "msg user";
    d.innerHTML = '<div class="who">我</div><div class="bubble"></div>';
    d.querySelector(".bubble").textContent = ev.text || "";
    if (Array.isArray(ev.images) && ev.images.length) {
      const row = document.createElement("div");
      row.className = "msg-images";
      for (const im of ev.images) {
        const tag = document.createElement("span");
        tag.className = "msg-image";
        const label = im.name || String(im.mediaType || "image").replace("image/", "").toUpperCase();
        const size = im.bytes ? " · " + Math.max(1, Math.round(im.bytes / 1024)) + "KB" : "";
        tag.textContent = "🖼 " + label + size;
        row.appendChild(tag);
      }
      d.appendChild(row);
    }
    chat.appendChild(d);
    lastUserSeq = ev.seq;
    $("pending").classList.remove("hidden");
  } else if (ev.kind === "assistant_delta") {
    const live = getLive(ev.streamId || "stream");
    if (!live.textEl) {
      const d = document.createElement("div");
      d.className = "msg left";
      d.innerHTML = '<div class="who">DSH</div><div class="bubble"></div>';
      live.textEl = d;
      live.bubble = d.querySelector(".bubble");
      chat.appendChild(d);
    }
    live.bubble.textContent += ev.text || "";
  } else if (ev.kind === "thinking_delta") {
    const live = getLive(ev.streamId || "stream");
    if (!live.thinkEl) {
      const d = document.createElement("details");
      d.className = "think";
      d.open = true;
      const sum = document.createElement("summary");
      sum.textContent = "💭 思考过程（实时）";
      const body = document.createElement("div");
      body.className = "think-body";
      d.appendChild(sum);
      d.appendChild(body);
      live.thinkEl = d;
      live.thinkBody = body;
      chat.appendChild(d);
    }
    live.thinkBody.textContent += ev.text || "";
  } else if (ev.kind === "assistant_final") {
    const live = liveStreams.get(ev.streamId || "stream") || { textEl: null };
    if (live.textEl) {
      live.bubble.innerHTML = mdLite(ev.text || "");
    } else {
      const d = document.createElement("div");
      d.className = "msg left";
      d.innerHTML = '<div class="who">DSH</div><div class="bubble"></div>';
      d.querySelector(".bubble").innerHTML = mdLite(ev.text || "");
      chat.appendChild(d);
    }
    if (live.thinkEl && live.thinkEl.querySelector("summary")) {
      live.thinkEl.open = false;
      live.thinkEl.querySelector("summary").textContent = "💭 思考过程";
    }
    liveStreams.delete(ev.streamId || "stream");
    lastUserSeq = 0;
    setRunning(false);
  } else if (ev.kind === "stream_end") {
    const live = liveStreams.get(ev.streamId || "stream");
    if (live) {
      if (live.thinkEl && live.thinkEl.querySelector("summary")) {
        live.thinkEl.open = false;
        live.thinkEl.querySelector("summary").textContent = "💭 思考过程";
      }
      if (live.textEl && !live.bubble.textContent) live.textEl.remove();
      liveStreams.delete(ev.streamId || "stream");
    }
  } else if (ev.kind === "assistant") {
    const d = document.createElement("div");
    d.className = "msg left";
    d.innerHTML = '<div class="who">DSH</div><div class="bubble"></div>';
    d.querySelector(".bubble").innerHTML = mdLite(ev.text || "");
    chat.appendChild(d);
    clearPendingIfAfter(ev.seq);
    setRunning(false);
  } else if (ev.kind === "activity") {
    const d = document.createElement("div");
    d.className = "activity";
    d.textContent = ev.text || "";
    chat.appendChild(d);
    clearPendingIfAfter(ev.seq);
  } else if (ev.kind === "image") {
    const d = document.createElement("div");
    d.className = "shot";
    const img = document.createElement("img");
    img.src = "data:" + (ev.mime || "image/png") + ";base64," + ev.base64;
    d.appendChild(img);
    chat.appendChild(d);
    clearPendingIfAfter(ev.seq);
  } else if (ev.kind === "thinking") {
    const d = document.createElement("details");
    d.className = "think";
    const sum = document.createElement("summary");
    sum.textContent = "💭 思考过程";
    const body = document.createElement("div");
    body.className = "think-body";
    body.textContent = ev.text || "";
    d.appendChild(sum);
    d.appendChild(body);
    chat.appendChild(d);
  } else if (ev.kind === "tool") {
    // 工具行默认收起：🔧 开启一个新的折叠块，↳ 结果并入其中
    const t = ev.text || "";
    if (t.startsWith("↳")) {
      if (lastToolBody) {
        const r = document.createElement("div");
        r.className = "tool-result";
        r.textContent = t;
        lastToolBody.appendChild(r);
        if (lastToolSummary) lastToolSummary.classList.add(t.includes("✗") ? "fail" : "done");
        lastToolBody = null; // 结果已配对
      } else {
        const d = document.createElement("div");
        d.className = "toolline";
        d.textContent = t;
        chat.appendChild(d);
      }
    } else {
      const oneLine = t.replace(/\s+/g, " ");
      const d = document.createElement("details");
      d.className = "tool";
      const sum = document.createElement("summary");
      sum.textContent = oneLine.length > 72 ? oneLine.slice(0, 72) + "…" : oneLine;
      const body = document.createElement("div");
      body.className = "tool-body";
      const pre = document.createElement("pre");
      pre.textContent = t;
      body.appendChild(pre);
      d.appendChild(sum);
      d.appendChild(body);
      chat.appendChild(d);
      lastToolBody = body;
      lastToolSummary = sum;
    }
  } else if (ev.kind === "system") {
    const d = document.createElement("div");
    d.className = "sysline";
    d.textContent = ev.text || "";
    chat.appendChild(d);
    clearPendingIfAfter(ev.seq);
  }
  if (ev.seq > lastSeq) lastSeq = ev.seq;
  if (stick) scrollBottom();
}

function resetChat(text) {
  const chat = $("chat");
  chat.innerHTML = "";
  const d = document.createElement("div");
  d.className = "empty";
  d.textContent = text || "正在加载会话…";
  chat.appendChild(d);
  lastSeq = 0;
  lastUserSeq = 0;
  workerRunning = false;
  running = false;
  liveStreams.clear();
  updateSendButton();
  lastToolBody = null;
  lastToolSummary = null;
  $("pending").classList.add("hidden");
  // 只取最新一页；更早的在用户上拉时按需加载，避免长会话一次灌入几百条。
  historyWindow = HISTORY_PAGE;
  historyTotal = 0;
  historyHasMore = false;
  loadingOlder = false;
  port.postMessage({ type: "loadEvents", tail: historyWindow });
}

// ---------- 端口消息 ----------
function handlePortMessage(m) {
  if (!m || typeof m !== "object") return;
  if (m.type === "status") renderStatus(m);
  if (m.type === "engine") renderEngine(m.engine);
  if (m.type === "sessions") renderSessions(m);
  if (m.type === "sessionsError") { $("session-hint").textContent = "会话列表加载失败：" + (m.error || ""); }
  if (m.type === "models") renderModels(m);
  if (m.type === "reset") resetChat("正在切换会话…");
  if (m.type === "tabs") renderTabs(m.tabs);
  if (m.type === "session" && m.event) {
    const ev = m.event;
    appendEvent(ev);
    if (ev.kind === "system" && /^⚡/.test(ev.text || "")) {
      workerRunning = true;
      pendingEl().textContent = "⚙ DSH 正在后台执行…（无界面，进展看上方事件流）";
      pendingEl().classList.remove("hidden");
    } else if (ev.kind === "assistant") {
      workerRunning = false;
      lastUserSeq = 0;
      pendingEl().classList.add("hidden");
    } else if (ev.kind === "system" && /^(⚠|⏱)/.test(ev.text || "")) {
      workerRunning = false;
      lastUserSeq = 0;
      pendingEl().classList.add("hidden");
    }
  }
  if (m.type === "events") {
    const rawList = Array.isArray(m.events) ? m.events : [];
    const serverTotal = Number(m.total || 0);
    const win = Math.max(1, Number(m.tail) || (m.older ? historyWindow : HISTORY_PAGE));
    let list = rawList;
    let hasMore;
    if (serverTotal > 0) {
      historyTotal = serverTotal;
      hasMore = m.hasMore === true;
    } else {
      // 旧版桥接不认识 tail：它会把全部事件发回来，这里自己裁到窗口，
      // 保证升级顺序（先换扩展、后重启桥）也不会一次性渲染几百条。
      historyTotal = rawList.length;
      if (rawList.length > win) list = rawList.slice(-win);
      hasMore = rawList.length > win;
    }
    historyWindow = win;
    historyHasMore = hasMore;
    if (m.older) loadingOlder = false;
    if (m.older) {
      renderHistory(list, { preserve: true });
    } else if (list.length) {
      renderHistory(list, { preserve: false });
    } else {
      const e0 = $("chat").querySelector(".empty");
      if (e0) e0.textContent = "已连上 DSH 会话通道。下第一条指令试试（例如：打开 example.com 告诉我标题）";
    }
  }
  if (m.type === "eventsError") {
    const chat = $("chat");
    if (!chat.children.length) {
      chat.innerHTML = '<div class="empty">无法加载会话历史：' + esc(m.error || "") + "</div>";
    }
  }
  if (m.type === "sayError") {
    const d = document.createElement("div");
    d.className = "sysline";
    d.textContent = "发送失败：" + (m.error || "");
    $("chat").appendChild(d);
    $("pending").classList.add("hidden");
    scrollBottom();
  }
  if (m.type === "sayOk") port.postMessage({ type: "getEngine" });
}

// ---------- 图片附件（逻辑对齐客户端 composer：粘贴 / 拖入 / 缩略图 / ✕ 移除） ----------
const MAX_ATTACH = 8;
const MAX_ATTACH_BYTES = 4 * 1024 * 1024;
const ATTACH_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
let attachments = [];
let attachSeq = 0;

function attachNotice(text) {
  const d = document.createElement("div");
  d.className = "sysline";
  d.textContent = text;
  $("chat").appendChild(d);
  scrollBottom();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("读取失败"));
    reader.readAsDataURL(file);
  });
}

async function addImageFiles(fileList) {
  const files = [...(fileList || [])].filter((f) => f && ATTACH_TYPES.has(f.type));
  if (!files.length) return;
  for (const file of files) {
    if (attachments.length >= MAX_ATTACH) { attachNotice("⚠ 最多附 " + MAX_ATTACH + " 张图片"); break; }
    if (file.size > MAX_ATTACH_BYTES) {
      attachNotice("⚠ 已跳过「" + (file.name || "图片") + "」：超过 4MB");
      continue;
    }
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(dataUrl);
      if (!m) continue;
      const mediaType = m[1].toLowerCase();
      if (!ATTACH_TYPES.has(mediaType)) continue;
      attachments.push({
        id: "a" + (++attachSeq),
        name: file.name || "粘贴的图片",
        mediaType,
        data: m[2],
        bytes: file.size,
        preview: dataUrl,
      });
    } catch {}
  }
  renderAttachTray();
}

function renderAttachTray() {
  const tray = $("attach-tray");
  tray.innerHTML = "";
  if (!attachments.length) { tray.classList.add("hidden"); return; }
  tray.classList.remove("hidden");
  for (const item of attachments) {
    const chip = document.createElement("div");
    chip.className = "attach-chip";
    chip.title = item.name + " · " + Math.max(1, Math.round(item.bytes / 1024)) + "KB";
    const img = document.createElement("img");
    img.src = item.preview;
    img.alt = item.name;
    const x = document.createElement("button");
    x.type = "button";
    x.className = "attach-x";
    x.setAttribute("aria-label", "移除图片");
    x.title = "移除";
    x.textContent = "✕";
    x.addEventListener("click", () => {
      attachments = attachments.filter((a) => a.id !== item.id);
      renderAttachTray();
    });
    chip.appendChild(img);
    chip.appendChild(x);
    tray.appendChild(chip);
  }
}

// ---------- 发送 ----------
function autoGrow() {
  const t = $("input");
  t.style.height = "auto";
  t.style.height = Math.min(t.scrollHeight, 120) + "px";
}

function send(text) {
  const t = $("input");
  const value = (text != null ? text : t.value).trim();
  const images = text == null ? attachments : [];
  if (!value && !images.length) return;
  if (!connected) return;
  if (text == null) {
    t.value = "";
    autoGrow();
    attachments = [];
    renderAttachTray();
  }
  setRunning(true);
  pendingEl().classList.remove("hidden");
  port.postMessage({
    type: "say",
    text: value,
    images: images.map((a) => ({ mediaType: a.mediaType, data: a.data, name: a.name })),
  });
}

function stopSession() {
  if (!running) return;
  port.postMessage({ type: "stop" });
  pendingEl().textContent = "正在停止…";
  pendingEl().classList.remove("hidden");
}

$("btn-send").addEventListener("click", () => {
  if (running) stopSession();
  else send();
});
$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (running) stopSession(); else send(); }
});
$("input").addEventListener("input", autoGrow);

// 粘贴图片：与客户端一致，图片进托盘，不把二进制塞进 textarea
$("input").addEventListener("paste", (e) => {
  const files = [...((e.clipboardData && e.clipboardData.files) || [])].filter((f) => f.type && f.type.indexOf("image/") === 0);
  if (!files.length) return;
  e.preventDefault();
  void addImageFiles(files);
});

// 拖入图片：覆盖整个 composer 区域
(() => {
  const composer = document.querySelector(".composer");
  if (!composer) return;
  const hasFiles = (e) => {
    const types = e.dataTransfer && e.dataTransfer.types;
    return types ? [...types].indexOf("Files") >= 0 : false;
  };
  composer.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    composer.classList.add("drag-over");
  });
  composer.addEventListener("dragleave", (e) => {
    if (composer.contains(e.relatedTarget)) return;
    composer.classList.remove("drag-over");
  });
  composer.addEventListener("drop", (e) => {
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    e.preventDefault();
    composer.classList.remove("drag-over");
    void addImageFiles(files);
  });
})();

// ---------- 历史分页触发器 / 卡住自愈 ----------
$("chat").addEventListener("scroll", () => {
  const c = $("chat");
  if (c.scrollTop > 60) return;
  requestOlderHistory();
});

// 长时间没有任何事件但界面仍显示"正在执行"时，向宿主核对一次真实状态，
// 避免侧边栏停在过期状态（例如 turn/end 帧在断线期间丢失）。
setInterval(() => {
  if (!running) return;
  const idle = Date.now() - lastEventAt;
  if (idle < 60000) return;
  port.postMessage({ type: "getEngine" });
  if (idle > 5 * 60000) {
    pendingEl().textContent = "⚠ 超过 5 分钟没有进展：可点停止按钮，或关掉侧边栏重开";
    pendingEl().classList.remove("hidden");
  }
}, 20000);

// ---------- 标签页 ----------
function renderTabs(tabs) {
  const ul = $("tab-list");
  ul.innerHTML = "";
  if (!tabs || !tabs.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "没有打开的标签页";
    ul.appendChild(li);
    return;
  }
  for (const t of tabs) {
    const li = document.createElement("li");
    if (t.active) li.classList.add("active");
    const title = document.createElement("span");
    title.className = "t-title";
    title.textContent = t.title || t.url || "(无标题)";
    const url = document.createElement("span");
    url.className = "t-url";
    url.textContent = t.url || "";
    li.appendChild(title);
    li.appendChild(url);
    li.addEventListener("click", () => port.postMessage({ type: "activate", tabId: t.tabId }));
    ul.appendChild(li);
  }
}

$("btn-refresh").addEventListener("click", () => {
  port.postMessage({ type: "getTabs" });
  port.postMessage({ type: "getEngine" });
  refreshSessions(true);
});
$("btn-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());

// ---------- 初始化 / 断线重连 ----------
function bootstrap() {
  resetChat("正在连接 DSH 会话…");
  port.postMessage({ type: "getTabs" });
  port.postMessage({ type: "getEngine" });
  port.postMessage({ type: "getModels" });
  refreshSessions(false);
  setTimeout(() => {
    if (!connected) updateBanner();
  }, 1200);
}

function connectPort() {
  let p;
  try {
    p = chrome.runtime.connect({ name: "sidepanel" });
  } catch {
    setTimeout(() => { port = connectPort(); if (port) bootstrap(); }, 800);
    return null;
  }
  p.onMessage.addListener(handlePortMessage);
  p.onDisconnect.addListener(() => {
    if (port !== p) return;
    connected = false;
    updateBanner();
    updateDisabled();
    setTimeout(() => {
      if (port !== p) return;
      port = connectPort();
      if (port) bootstrap();
    }, 600);
  });
  return p;
}

port = connectPort();
if (port) bootstrap();
