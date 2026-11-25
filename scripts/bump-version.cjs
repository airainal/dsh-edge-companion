// 改版本号而不写 BOM（PowerShell 5.1 的 Set-Content -Encoding UTF8 会加 BOM，
// 导致 DSH bundle 加载器 JSON.parse 失败、插件被静默丢弃）。
// 用法：node scripts/bump-version.cjs <repoVersion> <pluginVersion>
//   repoVersion   -> package.json
//   pluginVersion -> dsh-plugin/package.json + dsh-plugin/agent-host.js VERSION
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const [repoVersion, pluginVersion] = process.argv.slice(2);
if (!repoVersion && !pluginVersion) {
  console.error('usage: node scripts/bump-version.cjs <repoVersion> <pluginVersion>');
  process.exit(2);
}

function rewrite(rel, mutate) {
  const file = path.join(root, rel);
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const next = mutate(text);
  if (next === text) {
    console.log('unchanged', rel);
    return;
  }
  fs.writeFileSync(file, next, 'utf8'); // utf8 不写 BOM
  console.log('updated', rel);
}

if (repoVersion) {
  rewrite('package.json', (t) => t.replace(/"version":\s*"[^"]+"/, `"version": "${repoVersion}"`));
}
if (pluginVersion) {
  rewrite('dsh-plugin/package.json', (t) => t.replace(/"version":\s*"[^"]+"/, `"version": "${pluginVersion}"`));
  rewrite('dsh-plugin/agent-host.js', (t) => t.replace(/const VERSION = "[^"]+"/, `const VERSION = "${pluginVersion}"`));
}
