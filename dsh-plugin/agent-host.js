// DSH Agent Host - runs inside the DeepSeek Harness desktop process.
//
// It gives the Edge bridge a live control channel into the *same* desktop
// Session Controller the client uses:
//   - prompt:  submit a normal user turn to the selected session
//   - stop:    cancel that session's active turn (same as the client stop)
//   - follow:  stream durable events plus assistant text/reasoning deltas
//
// There is no second agent and no headless CLI in this path. When this plugin
// is connected the bridge routes sidebar actions here; the headless path stays
// as a fallback.
const PORT = Number(process.env.DSHEDGE_PORT || 8766);
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;
const VERSION = "2.0.0";

let ctx = null;
let ws = null;
let connecting = false;
let helloOk = false;
let reconnectTimer = null;
let nextId = 1;
let generation = 0;
const pending = new Map(); // bridge request id -> {resolve,reject,timer}

let followAbort = null;
let followSessionId = null;
let followActive = false;
let running = false;

function log(...args) {
  console.log("[dsh-agent-host]", ...args);
}

function scheduleReconnect(my) {
  if (my !== generation || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (my === generation) connect(my);
  }, 1500);
}

function send(method, params = {}) {
  if (!ws || ws.readyState !== 1) return false;
  try {
    ws.send(JSON.stringify({ method, params }));
    return true;
  } catch {
    return false;
  }
}

function connect(my) {
  if (my !== generation) return;
  if (connecting || helloOk) return;
  if (typeof WebSocket === "undefined") {
    log("WebSocket global unavailable in this runtime; retrying");
    scheduleReconnect(my);
    return;
  }
  connecting = true;
  let socket;
  try {
    socket = new WebSocket(WS_URL);
  } catch (e) {
    connecting = false;
    log("connect failed:", String(e && e.message ? e.message : e));
    scheduleReconnect(my);
    return;
  }
  ws = socket;

  socket.onopen = () => {
    if (my !== generation) { try { socket.close(); } catch {} return; }
    connecting = false;
    log("bridge connected, sending agentHello");
    socket.send(JSON.stringify({
      id: nextId++,
      method: "agentHello",
      params: { version: VERSION, capabilities: { stream: true, stop: true, codex: true } },
    }));
  };

  socket.onmessage = (event) => {
    if (my !== generation) return;
    let msg;
    try { msg = JSON.parse(typeof event.data === "string" ? event.data : String(event.data)); } catch { return; }
    if (!msg || typeof msg !== "object") return;

    if (msg.id != null && msg.method == null && (msg.result !== undefined || msg.error !== undefined)) {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.error !== undefined) p.reject(new Error(String(msg.error)));
        else p.resolve(msg.result);
      }
      return;
    }

    if (msg.method === "agentReady") {
      if (my !== generation) return;
      helloOk = true;
      log("bridge accepted agent host");
      send("hostStatus", { sessionId: followSessionId, running });
      void refreshCodex();
      return;
    }

    if (msg.method && msg.id != null) {
      handleBridgeRequest(msg.method, msg.params || {})
        .then((result) => {
          if (my === generation && ws && ws.readyState === 1) ws.send(JSON.stringify({ id: msg.id, result }));
        })
        .catch((e) => {
          const text = String(e && e.message ? e.message : e);
          if (my === generation && ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ id: msg.id, error: text }));
          }
          if (/inactive context|required service|disposed/i.test(text)) {
            log("plugin context inactive; dropping host socket");
            try { socket.close(); } catch {}
          }
        });
    }
  };

  socket.onclose = () => {
    if (my !== generation) return;
    connecting = false;
    helloOk = false;
    ws = null;
    followAbort?.abort();
    followAbort = null;
    log("bridge disconnected; will retry");
    scheduleReconnect(my);
  };

  socket.onerror = () => {
    // onclose handles reconnection
  };
}

async function handleBridgeRequest(method, params) {
  switch (method) {
    case "hostPing": {
      await ctx.sessionController.list({}, AbortSignal.timeout(3000));
      return { pong: true };
    }
    case "hostCreate": {
      const sessionId = await createSession();
      return { sessionId };
    }
    case "hostPrompt": {
      const sessionId = String(params.sessionId || "");
      await prompt(String(params.text || ""), sessionId);
      return { accepted: true, sessionId: followSessionId };
    }
    case "hostStop": {
      const sessionId = String(params.sessionId || followSessionId || "");
      return await stop(sessionId);
    }
    case "hostFollow": {
      const sessionId = String(params.sessionId || "");
      await follow(sessionId, true);
      return { following: followSessionId };
    }
    case "hostSessions": {
      const value = await ctx.sessionController.list({}, AbortSignal.timeout(8000));
      const items = (value.items || []).map((s) => ({
        sessionId: s.sessionId,
        running: s.running === true,
        agentAvailable: s.agentAvailable === true,
        blank: s.blank === true,
        updatedAt: s.updatedAt,
        cwd: s.cwd,
      }));
      return { sessions: items };
    }
    case "hostModels": {
      return await hostModels(params.force === true);
    }
    case "hostModelSet": {
      return await hostModelSet(params);
    }
    case "hostStatus": {
      return { sessionId: followSessionId, running, codex: await readCodex() };
    }
    default:
      throw new Error("unknown host request: " + method);
  }
}

async function createSession() {
  const preset = await ctx.agentPresets.resolve().catch(() => undefined);
  const cwd = ctx.workingDirectory?.defaultDirectory || undefined;
  const request = {};
  if (cwd) request.cwd = cwd;
  if (preset && preset.id) request.agentPreset = preset.id;
  const created = await ctx.sessionController.create(request);
  const sessionId = String(created.sessionId);
  log("created desktop session", sessionId, "preset", created.agentPreset || preset?.id || "?");
  running = false;
  await follow(sessionId);
  send("hostSession", { sessionId, preset: created.agentPreset || preset?.id || "" });
  return sessionId;
}

async function prompt(text, sessionId) {
  const id = sessionId || await createSession();
  const resolved = await ctx.sessionController.resolveAgent(id);
  if (resolved && resolved.error) {
    throw new Error("session resolve failed: " + String(resolved.error.code || resolved.error.message || resolved.error));
  }
  const requestId = `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await ctx.sessionController.prompt({
    requestId,
    sessionId: id,
    mode: "queue",
    content: [{ type: "text", text }],
  }, AbortSignal.timeout(15000));
  running = true;
  send("hostStatus", { sessionId: id, running: true, codex: await readCodex() });
  await follow(id, true);
  log("prompt accepted", id, text.slice(0, 60));
}

async function stop(sessionId) {
  const id = sessionId || followSessionId;
  if (!id) return { accepted: false, reason: "no session" };
  const result = await ctx.sessionController.cancel({ sessionId: id });
  running = false;
  send("hostStatus", { sessionId: id, running: false });
  log("cancel requested", id);
  return result;
}

async function follow(sessionId, force = false) {
  if (!sessionId) return;
  if (!force && followSessionId === sessionId && followAbort && !followAbort.signal.aborted && followActive) return;

  try {
    const resolved = await ctx.sessionController.resolveAgent(sessionId);
    if (resolved && resolved.error) log("resolve before follow failed:", String(resolved.error.code || resolved.error.message || resolved.error));
  } catch (e) {
    log("resolve before follow threw:", String(e && e.message ? e.message : e));
  }

  followAbort?.abort();
  followAbort = new AbortController();
  followSessionId = sessionId;
  followActive = true;
  modelState = null;
  const my = followAbort;
  const signal = my.signal;
  log("following", sessionId);
  refreshModelState(true).catch(() => {});

  (async () => {
    try {
      const frames = ctx.sessionController.follow({
        address: { kind: "session", sessionId },
        assistantStream: true,
        maxMessages: 120,
      }, signal);
      for await (const frame of frames) {
        if (signal.aborted) break;
        send("hostFrame", { sessionId, frame });
        if (frame && frame.type === "snapshot" && frame.projections && frame.projections.values) {
          updateModelState(frame.projections.values.modelSelection);
        }
        const event = frame && frame.type === "event" ? frame.event : null;
        if (event && event.type === "turn/start") {
          running = true;
          send("hostStatus", { sessionId, running: true });
        } else if (event && event.type === "turn/end") {
          running = false;
          send("hostStatus", { sessionId, running: false });
        }
      }
    } catch (e) {
      if (!signal.aborted) {
        log("follow ended:", String(e && e.message ? e.message : e));
        send("hostError", { sessionId, error: String(e && e.message ? e.message : e) });
      }
    } finally {
      if (followAbort === my) followActive = false;
    }
  })();
}

let codexCache = { at: 0, enabled: false };

// ---- model catalog / current selection (synced with the desktop client) ----
let modelState = null; // { provider, model, reasoningEffort? }
let modelCatalogCache = { at: 0, value: null };
let modelSetAt = 0;

function sameSelection(a, b) {
  if (!a || !b) return a === b;
  return a.provider === b.provider && a.model === b.model && (a.reasoningEffort || "") === (b.reasoningEffort || "");
}

function cleanSelection(value) {
  if (!value || typeof value !== "object") return null;
  const provider = String(value.provider || "");
  const model = String(value.model || "");
  if (!provider || !model) return null;
  const out = { provider, model };
  if (value.reasoningEffort !== undefined && value.reasoningEffort !== null && String(value.reasoningEffort) !== "") {
    out.reasoningEffort = String(value.reasoningEffort);
  }
  return out;
}

function updateModelState(next, force = false) {
  const sel = cleanSelection(next);
  if (!sel) return;
  if (!force && sameSelection(sel, modelState)) return;
  modelState = sel;
  send("hostModel", { current: sel });
}

async function readModelSelection() {
  if (!followSessionId) return null;
  try {
    const res = await ctx.sessionController.projections({ sessionId: followSessionId }, AbortSignal.timeout(4000));
    const values = res && res.values ? res.values : null;
    return cleanSelection(values && values.modelSelection);
  } catch {
    return null;
  }
}

async function refreshModelState(force = false) {
  if (!helloOk || !followSessionId) return;
  if (!force && Date.now() - modelSetAt < 3000) return; // our own selection may not be projected yet
  const sel = await readModelSelection();
  if (sel) updateModelState(sel, force);
}

function normalizeModelCatalog(cat) {
  const groups = (cat && Array.isArray(cat.groups) ? cat.groups : []).map((g) => ({
    id: String(g.id || ""),
    name: String(g.name || g.id || ""),
    models: (Array.isArray(g.models) ? g.models : []).map((m) => {
      const model = {
        id: String(m.id || ""),
        name: String(m.name || m.id || ""),
      };
      if (m.description) model.description = String(m.description);
      if (m.reasoning && Array.isArray(m.reasoning.efforts)) {
        model.reasoning = {
          defaultEffort: m.reasoning.defaultEffort ? String(m.reasoning.defaultEffort) : undefined,
          efforts: m.reasoning.efforts.map((e) => ({ id: String(e.id || ""), name: String(e.name || e.id || "") })),
        };
      }
      return model;
    }),
  }));
  const out = { groups };
  const def = cleanSelection(cat && cat.default);
  if (def) out.default = def;
  if (cat && Array.isArray(cat.failures)) {
    out.failures = cat.failures.map((f) => ({ id: String(f.id || ""), name: String(f.name || ""), message: String(f.message || "") }));
  }
  return out;
}

async function hostModels(force = false) {
  if (force || !modelCatalogCache.value || Date.now() - modelCatalogCache.at > 15000) {
    const cat = await ctx.sessionController.modelCatalog();
    modelCatalogCache = { at: Date.now(), value: normalizeModelCatalog(cat) };
  }
  const current = modelState || (await readModelSelection()) || modelCatalogCache.value.default || null;
  if (current && !modelState) modelState = current;
  return { catalog: modelCatalogCache.value, current };
}

async function hostModelSet(params) {
  if (!followSessionId) throw new Error("no active session");
  const provider = String(params.provider || "");
  const model = String(params.model || "");
  if (!provider || !model) throw new Error("provider and model are required");
  const request = { sessionId: followSessionId, provider, model };
  if (params.reasoningEffort !== undefined && params.reasoningEffort !== null && String(params.reasoningEffort) !== "") {
    request.reasoningEffort = String(params.reasoningEffort);
  }
  const result = await ctx.sessionController.selectModel(request);
  const selected = cleanSelection(result && result.selected) || cleanSelection(request);
  modelSetAt = Date.now();
  updateModelState(selected, true);
  modelCatalogCache = { at: 0, value: null };
  log("model selected", selected.provider + "/" + selected.model + (selected.reasoningEffort ? " effort=" + selected.reasoningEffort : ""));
  return { current: modelState };
}

async function readCodex() {
  if (Date.now() - codexCache.at < 3000) return codexCache.enabled;
  let enabled = false;
  try {
    const id = followSessionId;
    if (id) {
      const resolved = await ctx.sessionController.resolveAgent(id);
      const agent = resolved && resolved.agent;
      if (agent) {
        const preset = ctx.permissionPresets.current(agent.session);
        enabled = String(preset || "").startsWith("codex-");
      }
    }
  } catch {}
  codexCache = { at: Date.now(), enabled };
  return enabled;
}

async function refreshCodex() {
  const enabled = await readCodex();
  send("hostCodex", { enabled });
}

export function startAgentHost(pluginCtx) {
  const get = (name) => {
    try {
      if (pluginCtx[name]) return pluginCtx[name];
      return pluginCtx.get ? pluginCtx.get(name) : undefined;
    } catch {
      return undefined;
    }
  };
  const sessionController = get("sessionController");
  if (!sessionController) {
    log("no sessionController in this profile; headless fallback only");
    return;
  }
  ctx = {
    sessionController,
    agentPresets: get("agentPresets"),
    permissionPresets: get("permissionPresets"),
    workingDirectory: get("workingDirectory"),
  };

  generation += 1;
  const my = generation;

  // A HMR reload reuses this module. Tear down the previous socket so the
  // bridge never keeps routing to a disposed plugin context.
  try { ws?.close(); } catch {}
  ws = null;
  helloOk = false;
  connecting = false;
  pending.clear();
  followAbort?.abort();
  followAbort = null;
  followSessionId = null;
  running = false;
  codexCache = { at: 0, enabled: false };
  modelState = null;
  modelCatalogCache = { at: 0, value: null };

  log("starting; bridge", WS_URL);
  connect(my);

  const timer = setInterval(async () => {
    if (my !== generation || !helloOk) return;
    try {
      const value = await ctx.sessionController.list({}, AbortSignal.timeout(5000));
      const sessions = (value.items || []).map((s) => ({
        sessionId: s.sessionId,
        running: s.running === true,
        agentAvailable: s.agentAvailable === true,
        blank: s.blank === true,
        updatedAt: s.updatedAt,
        cwd: s.cwd,
      }));
      send("hostSessions", { sessions });
    } catch {}
  }, 5000);

  // Model/reasoning is session-projected; poll keeps the side panel in sync
  // when the desktop client changes it (selection writes no session event).
  const modelTimer = setInterval(() => {
    if (my !== generation || !helloOk || !followSessionId) return;
    refreshModelState(false).catch(() => {});
  }, 2000);

  pluginCtx.effect(() => () => {
    if (my !== generation) return;
    generation += 1; // make the closing socket's onclose stop reconnecting
    clearInterval(timer);
    clearInterval(modelTimer);
    try { ws?.close(); } catch {}
    followAbort?.abort();
  }, "dsh-edge-bridge agent host lifecycle");
}
