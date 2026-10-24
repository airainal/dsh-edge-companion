// 为一次性测试 profile 预置「已加载解压缩扩展」的 Preferences 记录（不触碰用户真实浏览器）
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2]);
const profile = path.resolve(process.argv[3]);
const extDir = path.join(root, "extension");
const manifest = JSON.parse(fs.readFileSync(path.join(extDir, "manifest.json"), "utf8"));
// 扩展 ID 由 manifest.key 派生（nibble → a-p）
import crypto from "node:crypto";
const der = Buffer.from(manifest.key, "base64");
const hex = crypto.createHash("sha256").update(der).digest("hex").slice(0, 32);
const id = [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");

const prefsFile = path.join(profile, "Default", "Preferences");
fs.mkdirSync(path.dirname(prefsFile), { recursive: true });
let prefs = {};
try { prefs = JSON.parse(fs.readFileSync(prefsFile, "utf8")); } catch {}
prefs.extensions ??= {};
prefs.extensions.settings ??= {};
prefs.extensions.settings[id] = {
  active_permissions: {
    api: ["debugger", "tabs", "storage", "alarms", "sidePanel"],
    explicit_host: [],
    scriptable_host: [],
  },
  creation_flags: 38,
  from_webstore: false,
  location: 4,
  manifest,
  path: extDir,
  state: 1,
  was_installed_by_default: false,
  was_installed_by_oem: false,
};
fs.writeFileSync(prefsFile, JSON.stringify(prefs));
console.log(JSON.stringify({ id, extDir, prefsFile, name: manifest.name }, null, 1));
