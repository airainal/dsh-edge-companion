// DSH Edge Bridge - Host plugin.
//
// Starts the local bridge (../bridge/bridge.mjs) once when DeepSeek Harness boots.
// The bridge is deliberately left running after DSH exits: the Edge extension keeps
// working, and the next DSH start reuses the already-running instance.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function startBridge() {
  if (started) return;
  started = true;

  const script = findBridge();
  if (!script) {
    console.warn("[dsh-edge-bridge] bridge.mjs not found; keep the dsh-edge-companion folder intact next to dsh-plugin.");
    return;
  }

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

export function apply() {
  startBridge();
}
