// DSH JS 会话客户端：驱动用户真实 Edge（经本地桥接，默认 127.0.0.1:8766）
// 用法（node REPL / 脚本里）：
//   const edge = await import("file:///C:/Users/a/Documents/deepseek-harness/default-workspace/dsh-edge-companion/client/edge.mjs");
//   await edge.status();  await edge.tabs();  await edge.open("https://example.com/");
//   await edge.treeOf(201);  await edge.click(201, 12);  await edge.shot(201);

const BASE = process.env.EDGE_URL || process.env.DSHEDGE_URL || "http://127.0.0.1:8766";

async function j(method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json; charset=utf-8" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

export async function status() { return j("GET", "/status"); }
export async function engine() { return j("GET", "/engine"); }
export async function tabs() { return j("GET", "/tabs"); }
export async function tab(tabId) { return j("GET", `/tabs/${tabId}`); }

export async function open(url, { active = true, wait = true } = {}) {
  return j("POST", "/tabs", { url, active, wait });
}

export async function goto(tabId, url, opts = {}) { return j("POST", `/tabs/${tabId}/goto`, { url, ...opts }); }
export async function activate(tabId) { return j("POST", `/tabs/${tabId}/activate`); }
export async function close(tabId) { return j("POST", `/tabs/${tabId}/close`); }

export async function snapshot(tabId) { return j("GET", `/tabs/${tabId}/snapshot`); }
export async function text(tabId, selector) {
  const qs = selector ? "?selector=" + encodeURIComponent(selector) : "";
  return j("GET", `/tabs/${tabId}/text${qs}`);
}
export async function extractQuestions(tabId) { return j("GET", `/tabs/${tabId}/questions`); }
export async function fillAnswers(tabId, answers) { return j("POST", `/tabs/${tabId}/fill-answers`, { answers }); }
export async function click(tabId, ref, opts = {}) { return j("POST", `/tabs/${tabId}/click`, { ref, ...opts }); }
export async function clickAt(tabId, x, y, opts = {}) { return j("POST", `/tabs/${tabId}/click`, { x, y, ...opts }); }
export async function fill(tabId, ref, value) { return j("POST", `/tabs/${tabId}/fill`, { ref, value }); }
export async function typeText(tabId, text, ref) { return j("POST", `/tabs/${tabId}/type`, ref != null ? { text, ref } : { text }); }
export async function press(tabId, key, ref) { return j("POST", `/tabs/${tabId}/press`, ref != null ? { key, ref } : { key }); }
export async function scroll(tabId, opts) { return j("POST", `/tabs/${tabId}/scroll`, opts); }
export async function hover(tabId, ref) { return j("POST", `/tabs/${tabId}/hover`, { ref }); }
export async function evalIn(tabId, expression, awaitPromise = true) {
  const r = await j("POST", `/tabs/${tabId}/eval`, { expression, awaitPromise });
  return r.value;
}
export async function cdp(tabId, method, params = {}, timeoutMs = 30000) {
  return j("POST", `/tabs/${tabId}/cdp`, { method, params, timeoutMs });
}

// 侧边栏会话通道
export async function claim() { return j("POST", "/session/claim"); }
export async function post(kind, text) { return j("POST", "/session/post", { kind, text }); }
export async function events(since = 0) { return j("GET", `/session/events?since=${Number(since)}`); }
export async function say(text) { return j("POST", "/session/say", { text }); }

// 把快照渲染成可读缩进树；interactiveOnly=true 时只看可交互元素
export function render(snap, { interactiveOnly = false, maxName = 60 } = {}) {
  const lines = [`# ${snap.title}`, snap.url, `readyState=${snap.readyState} nodes=${snap.nodeCount}`, ""];
  for (const n of snap.nodes) {
    if (interactiveOnly && !n.interactive && n.role !== "heading") continue;
    const pad = "  ".repeat(n.depth);
    const name = n.name ? ` "${n.name.slice(0, maxName)}"` : "";
    const extra = n.href ? ` -> ${n.href.slice(0, 80)}` : n.value !== undefined ? ` [${n.value}]` : "";
    lines.push(`${pad}[${n.ref}] ${n.role}${name}${extra}`);
  }
  return lines.join("\n");
}

export async function treeOf(tabId, opts) {
  return render(await snapshot(tabId), opts);
}

// 截图并直接显示（若宿主 REPL 提供 nodeRepl.emitImage）
export async function shot(tabId, { format = "png", fullPage = false } = {}) {
  const q = new URLSearchParams({ format });
  if (fullPage) q.set("fullPage", "1");
  const r = await fetch(`${BASE}/tabs/${tabId}/screenshot?${q}`);
  if (!r.ok) throw new Error(`screenshot -> ${r.status}: ${await r.text()}`);
  const buf = Buffer.from(await r.arrayBuffer());
  try { if (typeof nodeRepl !== "undefined") await nodeRepl.emitImage(new Uint8Array(buf)); } catch {}
  return { tabId, bytes: buf.length };
}

// 保存截图到文件（返回绝对路径）
export async function shotTo(tabId, filePath, opts = {}) {
  const q = new URLSearchParams({ raw: "0", ...opts });
  const data = await j("GET", `/tabs/${tabId}/screenshot?${q}`);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(filePath, Buffer.from(data.base64, "base64"));
  return filePath;
}
