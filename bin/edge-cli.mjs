#!/usr/bin/env node
// DSH Edge Bridge 命令行客户端 —— 供 DSH agent（含无头工作进程）与人类终端使用。
//
//   edge.cmd status
//   edge.cmd tabs
//   edge.cmd open https://example.com/
//   edge.cmd snapshot 123 --interactive
//   edge.cmd click 123 42
//   edge.cmd fill 123 42 @value.txt          # @file = 从 UTF-8 文件读取参数（中文安全）
//   edge.cmd eval 123 @expr.js
//   edge.cmd cdp 123 Page.navigate @params.json
//   edge.cmd questions 123
//   edge.cmd fill-answers 123 @answers.json
//   edge.cmd shot 123 out.png
//   edge.cmd claim | post assistant @reply.txt | events 0
//
// 环境变量：EDGE_URL / DSHEDGE_URL（默认 http://127.0.0.1:8766）

import fs from "node:fs";
import path from "node:path";

const BASE = process.env.EDGE_URL || process.env.DSHEDGE_URL || "http://127.0.0.1:8766";

async function api(method, p, body) {
  let res;
  try {
    res = await fetch(BASE + p, {
      method,
      headers: body ? { "Content-Type": "application/json; charset=utf-8" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    const msg = String((e && e.message) || e);
    fail(`无法连接桥接 ${BASE}：${msg}\n提示：先启动 bridge/start-bridge.cmd（桥接未起时扩展会一直重连）。`);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    const detail = data && data.error ? data.error : typeof data === "string" ? data : JSON.stringify(data);
    fail(`${method} ${p} -> HTTP ${res.status}: ${detail}`);
  }
  return data;
}

function fail(msg) {
  process.stderr.write(String(msg) + "\n");
  process.exit(1);
}

// 参数解码：@path 读 UTF-8 文件（Windows 下用文件传中文最稳），否则原样
function val(v) {
  if (typeof v !== "string") return v;
  if (v.startsWith("@")) {
    const file = v.slice(1);
    try {
      return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    } catch (e) {
      fail(`读取参数文件失败：${file}（${String(e.message || e)}）`);
    }
  }
  return v;
}

const int = (v, name) => {
  const n = Number(v);
  if (!Number.isFinite(n)) fail(`${name} 需要数字，收到：${v}`);
  return n;
};

function out(obj) {
  process.stdout.write(JSON.stringify(obj, null, 1) + "\n");
}

function flag(name) { return argv.includes("--" + name); }
function opt(name) {
  const i = argv.indexOf("--" + name);
  return i >= 0 ? argv[i + 1] : undefined;
}

const argv = process.argv.slice(2);
const cmd = argv[0];

function renderTree(snap, { interactiveOnly = false, maxName = 70 } = {}) {
  const lines = [
    `# ${snap.title || "(无标题)"}`,
    snap.url,
    `readyState=${snap.readyState} nodes=${snap.nodeCount} viewport=${snap.viewport ? snap.viewport.w + "x" + snap.viewport.h : "?"}`,
    "",
  ];
  for (const n of snap.nodes || []) {
    if (interactiveOnly && !n.interactive && !["heading", "radio", "checkbox", "option"].includes(n.role)) continue;
    const pad = "  ".repeat(Math.min(n.depth || 0, 12));
    const name = n.name ? ` "${String(n.name).slice(0, maxName)}"` : "";
    let extra = "";
    if (n.checked !== undefined) extra += n.checked ? " [checked]" : " [ ]";
    if (n.value !== undefined && n.value !== "") extra += ` [value=${String(n.value).slice(0, 40)}]`;
    if (n.href) extra += ` -> ${String(n.href).slice(0, 90)}`;
    lines.push(`${pad}[${n.ref}] ${n.role}${name}${extra}`);
  }
  return lines.join("\n");
}

async function main() {
  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    process.stdout.write(`DSH Edge Bridge CLI · 桥接 ${BASE}

用法：edge.cmd <命令> [参数]

  状态   status | engine
  标签页 tabs | open <url> [--background] | goto <tabId> <url> | close <tabId> | activate <tabId>
  读取   snapshot <tabId> [--interactive] [--json]
         text <tabId> [cssSelector]
         questions <tabId>
  操作   click <tabId> <ref> | click <tabId> --x N --y N
         fill <tabId> <ref> <value|@file>
         type <tabId> <text|@file> [ref]
         press <tabId> <key> [ref]
         hover <tabId> <ref>
         scroll <tabId> [--dx N] [--dy N] | --ref N | --x N --y N
         eval <tabId> <expression|@file> [--no-await]
         cdp <tabId> <Method> [params|@file] [--timeout ms]
         shot <tabId> <out.png> [--format png|jpeg|webp] [--full] [--quality 80]
  答题   fill-answers <tabId> <answers.json|@file>     # [{"index":1,"label":"T"}]
  会话   claim | events [since] | post <kind> <text|@file> | say <text|@file> | reset
  其它   shutdown

参数 @file 表示从 UTF-8 文件读取（中文、长文本、代码一律用文件，避免编码/引号问题）。
环境变量 EDGE_URL 可改桥接地址（默认 ${BASE}）。
`);
    return;
  }

  switch (cmd) {
    case "status": return out(await api("GET", "/status"));
    case "engine": return out(await api("GET", "/engine"));

    case "tabs": return out(await api("GET", "/tabs"));
    case "open": {
      const url = argv[1];
      if (!url) fail("open 需要 url");
      return out(await api("POST", "/tabs", { url: val(url), active: !flag("background") }));
    }
    case "goto": return out(await api("POST", `/tabs/${int(argv[1], "tabId")}/goto`, { url: val(argv[2] || "") }));
    case "close": return out(await api("POST", `/tabs/${int(argv[1], "tabId")}/close`));
    case "activate": return out(await api("POST", `/tabs/${int(argv[1], "tabId")}/activate`));

    case "snapshot": {
      const snap = await api("GET", `/tabs/${int(argv[1], "tabId")}/snapshot`);
      if (flag("json")) return out(snap);
      process.stdout.write(renderTree(snap, { interactiveOnly: flag("interactive") }) + "\n");
      return;
    }
    case "text": {
      const tabId = int(argv[1], "tabId");
      const sel = argv[2] && !argv[2].startsWith("--") ? val(argv[2]) : "";
      const qs = sel ? "?selector=" + encodeURIComponent(sel) : "";
      const r = await api("GET", `/tabs/${tabId}/text${qs}`);
      process.stdout.write((r.text || "") + "\n");
      return;
    }
    case "questions": return out(await api("GET", `/tabs/${int(argv[1], "tabId")}/questions`));

    case "click": {
      const tabId = int(argv[1], "tabId");
      if (argv.includes("--x")) return out(await api("POST", `/tabs/${tabId}/click`, { x: Number(opt("x")), y: Number(opt("y")) }));
      const ref = Number(argv[2]);
      if (!Number.isFinite(ref)) fail("click 需要 ref（来自 snapshot）或 --x/--y");
      return out(await api("POST", `/tabs/${tabId}/click`, { ref }));
    }
    case "fill": {
      const tabId = int(argv[1], "tabId");
      const ref = int(argv[2], "ref");
      return out(await api("POST", `/tabs/${tabId}/fill`, { ref, value: String(val(argv[3] === undefined ? "" : argv[3])) }));
    }
    case "type": {
      const tabId = int(argv[1], "tabId");
      const body = { text: String(val(argv[2] === undefined ? "" : argv[2])) };
      if (argv[3] != null && Number.isFinite(Number(argv[3]))) body.ref = Number(argv[3]);
      return out(await api("POST", `/tabs/${tabId}/type`, body));
    }
    case "press": {
      const tabId = int(argv[1], "tabId");
      const body = { key: String(val(argv[2] === undefined ? "" : argv[2])) };
      if (argv[3] != null && Number.isFinite(Number(argv[3]))) body.ref = Number(argv[3]);
      return out(await api("POST", `/tabs/${tabId}/press`, body));
    }
    case "hover": return out(await api("POST", `/tabs/${int(argv[1], "tabId")}/hover`, { ref: int(argv[2], "ref") }));
    case "scroll": {
      const tabId = int(argv[1], "tabId");
      const body = {};
      if (argv.includes("--ref")) body.ref = Number(opt("ref"));
      if (argv.includes("--x")) { body.x = Number(opt("x")); body.y = Number(opt("y")); }
      if (argv.includes("--dx")) body.dx = Number(opt("dx"));
      if (argv.includes("--dy")) body.dy = Number(opt("dy"));
      return out(await api("POST", `/tabs/${tabId}/scroll`, body));
    }
    case "eval": {
      const tabId = int(argv[1], "tabId");
      const expression = String(val(argv[2] === undefined ? "" : argv[2]));
      if (!expression) fail("eval 需要表达式（或 @file.js）");
      return out(await api("POST", `/tabs/${tabId}/eval`, { expression, awaitPromise: !flag("no-await") }));
    }
    case "cdp": {
      const tabId = int(argv[1], "tabId");
      const method = argv[2];
      if (!method) fail("cdp 需要 CDP 方法名，例如 Page.navigate / Runtime.evaluate / Input.dispatchMouseEvent");
      let params = {};
      if (argv[3] && !argv[3].startsWith("--")) {
        const raw = val(argv[3]);
        try { params = raw.trim() ? JSON.parse(raw) : {}; } catch { fail("cdp 参数不是合法 JSON：\n" + raw.slice(0, 400)); }
      }
      const body = { method, params };
      if (opt("timeout")) body.timeoutMs = Number(opt("timeout"));
      return out(await api("POST", `/tabs/${tabId}/cdp`, body));
    }
    case "shot": {
      const tabId = int(argv[1], "tabId");
      if (!argv[2]) fail("shot 需要输出文件路径");
      const outFile = path.resolve(val(argv[2]));
      const qs = new URLSearchParams({ raw: "0", activate: flag("no-activate") ? "0" : "1" });
      if (flag("full")) qs.set("fullPage", "1");
      if (opt("format")) qs.set("format", opt("format"));
      if (opt("quality")) qs.set("quality", opt("quality"));
      const r = await api("GET", `/tabs/${tabId}/screenshot?${qs}`);
      const buf = Buffer.from(r.base64, "base64");
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, buf);
      return out({ ok: true, path: outFile, bytes: buf.length, mimeType: r.mimeType });
    }

    case "fill-answers": {
      const tabId = int(argv[1], "tabId");
      const raw = val(argv[2] === undefined ? "" : argv[2]);
      let answers;
      try { answers = JSON.parse(raw); } catch { fail("fill-answers 需要 JSON 数组（建议 @answers.json）：" + String(raw).slice(0, 200)); }
      return out(await api("POST", `/tabs/${tabId}/fill-answers`, { answers }));
    }

    case "claim": return out(await api("POST", "/session/claim"));
    case "events": return out(await api("GET", `/session/events?since=${Number(argv[1] || 0)}`));
    case "post": {
      const kind = argv[1] || "assistant";
      const text = String(val(argv[2] === undefined ? "" : argv[2]));
      return out(await api("POST", "/session/post", { kind, text }));
    }
    case "say": {
      const text = String(val(argv[1] === undefined ? "" : argv[1]));
      return out(await api("POST", "/session/say", { text }));
    }
    case "reset": return out(await api("POST", "/session/reset"));
    case "shutdown": return out(await api("POST", "/shutdown"));

    default:
      fail(`未知命令：${cmd}\n运行 "edge.cmd --help" 查看用法。`);
  }
}

main().catch((e) => fail(String((e && e.stack) || e)));
