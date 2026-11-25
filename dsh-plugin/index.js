// DSH Edge Bridge - Host plugin.
//
// Starts the local bridge (../bridge/bridge.mjs) once when DeepSeek Harness boots.
// The bridge is deliberately left running after DSH exits: the Edge extension keeps
// working, and the next DSH start reuses the already-running instance.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startAgentHost } from "./agent-host.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.DSHEDGE_PORT || 8766);
let started = false;

function findBridge() {
  const candidates = [
    path.resolve(here, "..", "bridge", "bridge.mjs"),
    path.join(here, "bridge", "bridge.mjs"),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch {}
  }
  return "";
}

function findNode() {
  const candidates = [];
  if (process.env.DSH_NODE) candidates.push(process.env.DSH_NODE);
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, "runtime", "primary-runtime", "dependencies", "node", "bin", "node.exe"));
  }
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return { exe: p, electron: false }; } catch {}
  }
  // Electron main can act as Node for a plain script.
  return { exe: process.execPath, electron: true };
}

// Keep in sync with bridge/bridge.mjs VERSION: a mismatch makes the plugin treat
// the running bridge as outdated and replace it on the next DSH start.
const BRIDGE_VERSION = "1.3.6";

function readDiskBridgeVersion(script) {
  try {
    const src = fs.readFileSync(script, "utf8");
    const m = src.match(/const VERSION = "([^"]+)"/);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

async function runningBridgeVersion() {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1500) });
    const info = await res.json();
    return info && info.version ? String(info.version) : "";
  } catch {
    return "";
  }
}

async function restartBridge() {
  try {
    await fetch(`http://127.0.0.1:${port}/shutdown`, { method: "POST", signal: AbortSignal.timeout(2000) });
  } catch {}
  await new Promise((r) => setTimeout(r, 800));
  started = false;
  await startBridge();
}

/**
 * 桥接源码版本与运行中的版本不一致时自动换桥。
 * 这样更新 bridge.mjs 后不必重启整个 DSH；旧的 stopOutdatedBridge 只在启动时比常量。
 */
async function watchBridgeVersion() {
  const script = findBridge();
  if (!script) return;
  const disk = readDiskBridgeVersion(script);
  if (!disk) return;
  const running = await runningBridgeVersion();
  if (running && running !== disk) {
    console.log("[dsh-edge-bridge] bridge source", disk, "differs from running", running, "- replacing");
    await restartBridge();
  }
}

async function stopOutdatedBridge() {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1500) });
    const info = await res.json();
    if (info && info.version && info.version !== BRIDGE_VERSION) {
      console.log("[dsh-edge-bridge] replacing outdated bridge", info.version, "->", BRIDGE_VERSION);
      await fetch(`http://127.0.0.1:${port}/shutdown`, { method: "POST", signal: AbortSignal.timeout(2000) }).catch(() => {});
      await new Promise((r) => setTimeout(r, 700));
    }
  } catch {
    // no bridge listening: start fresh
  }
}

async function startBridge() {
  if (started) return;
  started = true;

  const script = findBridge();
  if (!script) {
    console.warn("[dsh-edge-bridge] bridge.mjs not found; keep the dsh-edge-companion folder intact next to dsh-plugin.");
    return;
  }

  await stopOutdatedBridge();

  const { exe, electron } = findNode();
  const env = { ...process.env, DSHEDGE_PORT: String(port) };
  if (electron) env.ELECTRON_RUN_AS_NODE = "1";
  // Put the engine's working directory at the companion root, so sessions created from
  // the sidebar live in a stable workspace instead of the installed plugin folder.
  if (!env.DSHEDGE_CWD) env.DSHEDGE_CWD = path.resolve(here, "..");

  try {
    const child = spawn(exe, [script], {
      cwd: path.dirname(script),
      env,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", (e) => console.warn("[dsh-edge-bridge] spawn failed:", e && e.message ? e.message : String(e)));
    child.unref();
    console.log("[dsh-edge-bridge] bridge started with", exe);
  } catch (e) {
    console.warn("[dsh-edge-bridge] spawn error:", e && e.message ? e.message : String(e));
  }
}

export const inject = [
  "sessionController",
  "agentPresets",
  "permissionPresets",
  "workingDirectory",
];

export function apply(ctx) {
  startBridge().catch((e) => console.warn("[dsh-edge-bridge] start failed:", e && e.message ? e.message : String(e)));
  // Same bundle also gives the side panel a live channel into the desktop
  // Session Controller (same Agent, not a second headless agent).
  startAgentHost(ctx);
  // 每 20 秒对一次桥接版本：改完 bridge.mjs 后自动热替换，不需要重启 DSH。
  const timer = setInterval(() => {
    watchBridgeVersion().catch(() => {});
  }, 20000);
  if (timer && typeof timer.unref === "function") timer.unref();
}
