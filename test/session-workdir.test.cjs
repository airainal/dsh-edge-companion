// 会话工作目录解析单测：只认客户端已注册的 workspace，绝不回退到"最近会话 cwd"。
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, "..", "bridge", "workdir.mjs")).href);
  const { resolveWorkdir, readWorkspaces, normCwd } = mod;

  const home = path.join(os.homedir(), ".dsh");
  const real = readWorkspaces(home);
  assert(real.defaultPath, "real DSH home should have a default workspace");
  const realDefault = normCwd(real.defaultPath);
  const profileDir = path.join(home, "profiles", "desktop");

  // 1) 活跃会话的 cwd 在 profile 目录（旧插件历史）→ 必须忽略，改用默认 workspace
  const sessions = [
    { sessionId: "s-wrong", cwd: profileDir, updatedAt: Date.now() },
    { sessionId: "s-ok", cwd: real.defaultPath, updatedAt: 1 },
  ];
  assert.equal(normCwd(resolveWorkdir({ dshHome: home, sessions, sessionId: "s-wrong" })), realDefault, "unregistered active cwd must be ignored");
  assert.equal(normCwd(resolveWorkdir({ dshHome: home, sessions, sessionId: "s-ok" })), realDefault, "registered cwd is kept");

  // 2) 没有任何会话 → 默认 workspace
  assert.equal(normCwd(resolveWorkdir({ dshHome: home, sessions: [], sessionId: "" })), realDefault);

  // 3) 只有未注册会话 → 仍回默认 workspace，而不是该会话的 profile 目录
  assert.equal(normCwd(resolveWorkdir({ dshHome: home, sessions: [{ sessionId: "x", cwd: profileDir }], sessionId: "x" })), realDefault);

  // 4) 临时 home：注册路径优先，未注册活跃 cwd 退回注册路径
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dshwd-"));
  try {
    const ws = path.join(tmp, "proj");
    fs.mkdirSync(ws, { recursive: true });
    fs.mkdirSync(path.join(tmp, "storages"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "storages", "workspace.json"), JSON.stringify({
      global: { defaultWorkspaceId: "w1" },
      tables: { workspaces: { w1: { path: ws } } },
    }));
    assert.equal(resolveWorkdir({ dshHome: tmp, sessions: [], sessionId: "" }), ws);
    assert.equal(resolveWorkdir({ dshHome: tmp, sessions: [{ sessionId: "s", cwd: path.join(tmp, "elsewhere") }], sessionId: "s" }), ws, "unregistered active cwd -> registered default");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log("default workspace:", real.defaultPath);
  console.log("session workdir tests: ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
