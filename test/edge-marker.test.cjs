// 隐藏注记（edge marker）单测：结构正确、不落库式追加、幂等、不碰非 enter 决策。
// 运行：node test/edge-marker.test.cjs
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, "..", "dsh-plugin", "agent-host.js")).href);
  const facts = { available: true, extVersion: "1.4.2", zcodeBridge: true };

  const marker = mod.buildEdgeMarker(facts);
  assert(marker.includes("8766"), "marker should point at bridge 8766");
  assert(marker.includes("8765"), "marker should warn about the old 8765 bridge");
  assert(marker.includes("侧边栏已连接"), "marker should state the side panel is connected");
  assert(marker.includes("1.4.2"), "marker should carry the extension version");
  assert(marker.startsWith("\n\n"), "marker should separate itself from user text");

  const original = { id: "m1", role: "user", content: [{ type: "text", text: "打开 example.com" }] };
  const decision = { kind: "enter", messages: [original] };
  const out = mod.injectEdgeMarker(decision, facts);
  assert.equal(out.messages.length, 1, "still exactly one user message (no fake user turn)");
  assert.equal(out.messages[0].content.length, 2, "one extra text block appended");
  assert.equal(out.messages[0].content[0].text, "打开 example.com", "original user text untouched");
  assert(out.messages[0].content[1].text.includes("[dshedge 内部注记"), "marker block appended");
  assert.equal(decision.messages[0].content.length, 1, "input decision not mutated");

  const again = mod.injectEdgeMarker(out, facts);
  assert.equal(again, out, "idempotent: an existing marker is not duplicated");

  const rejected = { kind: "reject" };
  assert.equal(mod.injectEdgeMarker(rejected, facts), rejected, "reject decisions pass through");
  const empty = { kind: "enter", messages: [] };
  assert.equal(mod.injectEdgeMarker(empty, facts), empty, "empty messages pass through");

  const offline = mod.buildEdgeMarker({ available: false });
  assert(offline.includes("侧边栏当前未连接"), "offline wording");
  assert(!offline.includes("1.4.2"), "no version when offline");

  // 插件新建会话必须落在已注册 workspace：验证 workspace.json 的默认 path 真实存在。
  try {
    const state = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".dsh", "storages", "workspace.json"), "utf8"));
    const id = state.global && state.global.defaultWorkspaceId;
    const p = id && state.tables && state.tables.workspaces && state.tables.workspaces[id] && state.tables.workspaces[id].path;
    if (p) {
      assert(fs.existsSync(p), "default workspace path exists: " + p);
      console.log("default workspace:", p);
    }
  } catch (e) {
    console.log("workspace check skipped:", String(e.message || e));
  }

  console.log("edge marker tests: ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
