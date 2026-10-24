// 设置页：保存桥接地址与令牌，保存后通知 service worker 重连
const $ = (id) => document.getElementById(id);

async function load() {
  const s = await chrome.storage.local.get(["bridgeUrl", "bridgeToken"]);
  $("url").value = s.bridgeUrl || "ws://127.0.0.1:8766/ws";
  $("token").value = s.bridgeToken || "";
  const st = await chrome.runtime.sendMessage({ type: "getStatus" });
  renderState(st);
}

function renderState(st) {
  const el = $("state");
  if (st && st.connected) {
    el.textContent = "● 已连接";
    el.className = "on";
  } else {
    el.textContent = "○ 未连接（自动重试中）";
    el.className = "off";
  }
}

$("save").addEventListener("click", async () => {
  const url = $("url").value.trim() || "ws://127.0.0.1:8766/ws";
  const token = $("token").value.trim();
  await chrome.storage.local.set({ bridgeUrl: url, bridgeToken: token });
  chrome.runtime.sendMessage({ type: "configSaved" });
  $("state").textContent = "已保存，正在重连…";
  $("state").className = "";
  setTimeout(async () => renderState(await chrome.runtime.sendMessage({ type: "getStatus" })), 1500);
});

load();
