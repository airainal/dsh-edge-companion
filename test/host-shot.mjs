import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("C:/Users/a/Documents/deepseek-harness/default-workspace/dsh-edge-companion");
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const port = 9340;
const profile = path.join(root, "test", "host-shot-profile");
const proc = spawn(edge, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); break; } catch { await sleep(250); } }
const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } };
const send = (method, params={}) => new Promise((resolve,reject)=>{ const i=++id; pending.set(i,{resolve,reject}); ws.send(JSON.stringify({id:i,method,params})); });
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 396, height: 1335, deviceScaleFactor: 1, mobile: false });
for (const state of ["running", "done"]) {
  await send("Page.navigate", { url: "file:///" + path.join(root, "test", "host-preview.html").replace(/\\/g,"/") + "?state=" + state });
  await sleep(1800);
  const dbg = await send("Runtime.evaluate", {
    expression: 'JSON.stringify({banner:document.getElementById("banner").className,children:document.getElementById("chat").children.length,text:document.getElementById("chat").innerText.slice(0,80),events:window.__events&&window.__events.length,dispatch:typeof window.__dispatch,listeners:window.__listenerCount,errs:window.__errs})',
    returnByValue: true,
  });
  console.log(state, dbg.result.value);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const file = path.join(root, "test", `host-${state}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
  console.log("wrote", file);
}
// effort menu open state
await send("Runtime.evaluate", { expression: 'document.getElementById("effort-btn").click()' });
await sleep(400);
const effortShot = await send("Page.captureScreenshot", { format: "png" });
const effortFile = path.join(root, "test", "host-effort.png");
fs.writeFileSync(effortFile, Buffer.from(effortShot.data, "base64"));
console.log("wrote", effortFile);
// model menu open state
await send("Runtime.evaluate", { expression: 'document.getElementById("effort-btn").click(); document.getElementById("model-btn").click()' });
await sleep(400);
const modelShot = await send("Page.captureScreenshot", { format: "png" });
const modelFile = path.join(root, "test", "host-models.png");
fs.writeFileSync(modelFile, Buffer.from(modelShot.data, "base64"));
console.log("wrote", modelFile);
ws.close(); proc.kill();
