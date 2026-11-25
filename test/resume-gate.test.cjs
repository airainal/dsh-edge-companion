// headless 续接门禁单测：有 agent preset 的会话不允许 one-shot runner 续接。
const assert = require("node:assert");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

(async () => {
  const { headlessResumeBlocker } = await import(pathToFileURL(path.join(__dirname, "..", "bridge", "resume-gate.mjs")).href);

  const cordis = headlessResumeBlocker({ agentPreset: "cordis" });
  assert(cordis.includes("cordis"), "cordis preset reported by name");
  assert(cordis.includes("不能续接"), "explains why it is blocked");

  assert(headlessResumeBlocker({ agentPreset: "standard" }), "any preset is blocked");
  assert.equal(headlessResumeBlocker({ agentPreset: "" }), "", "no preset -> allowed");
  assert.equal(headlessResumeBlocker({}), "", "missing header field -> allowed");
  assert.equal(headlessResumeBlocker(null), "", "missing header -> allowed");

  console.log("resume gate tests: ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
