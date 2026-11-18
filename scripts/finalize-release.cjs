#!/usr/bin/env node
// Finalize a GitHub release produced by .github/workflows/release.yml.
//
// The tag workflow builds the portable zip and a zip-only SHA256SUMS.txt. This
// script runs after it: uploads the npm tarball when it is missing, rewrites
// SHA256SUMS.txt so it covers every *.zip / *.tgz asset by their hosted digest,
// and renders the release body from the CHANGELOG section + release template.
//
// Inputs (env): GH_TOKEN, FRC_TAG, FRC_REPO (owner/name), FRC_TGZ (optional path),
//               FRC_ROOT (repo checkout, default cwd), FRC_WAIT_MS (default 600000)
// Output: one JSON object on stdout. Exit 0 ok, 1 API failure, 2 timeout/network.
"use strict";

const https = require("https");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.GH_TOKEN || "";
const TAG = (process.env.FRC_TAG || "").trim();
const REPO = (process.env.FRC_REPO || "").trim();
const TGZ = (process.env.FRC_TGZ || "").trim();
const TGZ_NAME = (process.env.FRC_TGZ_NAME || "").trim();
const ZIP_NAME = (process.env.FRC_ZIP_NAME || "").trim();
const RENDER_ONLY = process.env.FRC_RENDER_ONLY === "1";
const CREATE_TAG = process.env.FRC_CREATE_TAG === "1";
const BRANCH = (process.env.FRC_BRANCH || "main").trim();
const ROOT = process.env.FRC_ROOT || process.cwd();
const WAIT_MS = Number(process.env.FRC_WAIT_MS || 600000);
const VERSION = TAG.replace(/^v/, "");

if (!TOKEN || !TAG || !REPO) {
  console.error("missing GH_TOKEN / FRC_TAG / FRC_REPO");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(method, hostname, urlPath, body) {
  return new Promise((resolve) => {
    const raw = body === undefined || body === null ? null : (Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)));
    const req = https.request({
      host: hostname,
      path: urlPath,
      method,
      timeout: 90000,
      headers: {
        "user-agent": "dsh-finalize-release",
        accept: "application/vnd.github+json",
        authorization: "token " + TOKEN,
        "content-type": Buffer.isBuffer(body) ? "application/octet-stream" : "application/json",
        "content-length": raw === null ? 0 : raw.length,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch { /* binary or empty */ }
        resolve({ status: res.statusCode, json, text: json ? null : text.slice(0, 200) });
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => resolve({ error: e.message }));
    if (raw !== null) req.write(raw);
    req.end();
  });
}

const api = (method, p, body) => request(method, "api.github.com", `/repos/${REPO}${p}`, body);

function changelogSection(version) {
  const file = path.join(ROOT, "CHANGELOG.md");
  let lines;
  try { lines = fs.readFileSync(file, "utf8").split(/\r?\n/); } catch { return `## v${version}`; }
  const head = new RegExp("^##\\s+v" + version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(\\s|$)");
  let start = -1;
  for (let i = 0; i < lines.length; i++) if (head.test(lines[i])) { start = i; break; }
  if (start < 0) return `## v${version}`;
  const out = [];
  for (let i = start; i < lines.length; i++) {
    if (i > start && /^##\s+v/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join("\n").trim();
}

function renderBody(tgzName, zipName) {
  let template = "";
  try { template = fs.readFileSync(path.join(ROOT, "scripts", "release-template.md"), "utf8"); } catch { /* optional */ }
  const footer = template
    .replace(/\{\{TAG\}\}/g, TAG)
    .replace(/\{\{VERSION\}\}/g, VERSION)
    .replace(/\{\{REPO\}\}/g, REPO)
    .replace(/\{\{TGZ_NAME\}\}/g, tgzName || `dsh-edge-companion-${VERSION}.tgz`)
    .replace(/\{\{ZIP_NAME\}\}/g, zipName || `dsh-edge-companion-${VERSION}.zip`)
    .trim();
  return footer ? changelogSection(VERSION) + "\n\n" + footer : changelogSection(VERSION);
}

async function ensureTag() {
  const existing = await api("GET", `/git/ref/tags/${TAG}`);
  if (existing.status === 200) return { status: "exists", sha: existing.json && existing.json.object && existing.json.object.sha };
  if (existing.status !== 404) return { status: "lookup failed", http: existing.status };
  const head = await api("GET", `/git/ref/heads/${BRANCH}`);
  const sha = head.json && head.json.object && head.json.object.sha;
  if (!sha) return { status: "cannot read branch head", http: head.status };
  const created = await api("POST", `/git/refs`, { ref: `refs/tags/${TAG}`, sha });
  return { status: created.status === 201 ? "created" : "create failed", http: created.status, sha, message: created.json && created.json.message };
}

async function waitForWorkflow() {
  const deadline = Date.now() + WAIT_MS;
  let seen = false;
  let last = null;
  while (Date.now() < deadline) {
    const runs = await api("GET", `/actions/runs?per_page=40`);
    if (runs.error) return { status: "network", error: runs.error };
    const mine = (runs.json && runs.json.workflow_runs || []).filter((r) => r.name === "release" && r.head_branch === TAG);
    if (mine.length) {
      seen = true;
      const run = mine[0];
      last = { id: run.id, status: run.status, conclusion: run.conclusion, url: run.html_url };
      if (run.status === "completed") return { status: "completed", ...last };
    } else if (seen) {
      return { status: "vanished", ...(last || {}) };
    }
    await sleep(8000);
  }
  return { status: seen ? "timeout" : "no-run", ...(last || {}) };
}

async function ensureRelease() {
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const rel = await api("GET", `/releases/tags/${encodeURIComponent(TAG)}`);
    if (rel.status === 200) return rel.json;
    if (rel.status && rel.status !== 404) return { error: `release lookup HTTP ${rel.status}` };
    await sleep(5000);
  }
  return { error: "release was not created within 180s" };
}

async function uploadAsset(releaseId, file) {
  const name = path.basename(file);
  const buf = fs.readFileSync(file);
  return request("POST", "uploads.github.com", `/repos/${REPO}/releases/${releaseId}/assets?name=${encodeURIComponent(name)}`, buf);
}

(async () => {
  const out = { tag: TAG, version: VERSION };

  if (RENDER_ONLY) {
    out.body = renderBody(TGZ_NAME, ZIP_NAME);
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  if (CREATE_TAG) {
    out.tagRef = await ensureTag();
    if (!/^(exists|created)$/.test(String(out.tagRef.status))) {
      console.log(JSON.stringify({ ...out, error: "cannot create tag" }, null, 2));
      process.exit(1);
    }
  }

  out.workflow = await waitForWorkflow();
  const rel = await ensureRelease();
  if (rel.error) { console.log(JSON.stringify({ ...out, error: rel.error }, null, 2)); process.exit(1); }
  out.releaseId = rel.id;

  // 1) 补 npm tarball
  let assets = rel.assets || [];
  const hasTgz = assets.some((a) => a.name.endsWith(".tgz"));
  if (TGZ && !hasTgz) {
    if (!fs.existsSync(TGZ)) { out.tgz = { error: "tarball not found: " + TGZ }; }
    else {
      const up = await uploadAsset(rel.id, TGZ);
      out.tgz = { status: up.status, name: up.json && up.json.name, error: up.json && up.json.message };
    }
  } else if (hasTgz) {
    out.tgz = { skipped: "already present" };
  }

  // 2) 用线上摘要重写校验和
  const again = await api("GET", `/releases/tags/${encodeURIComponent(TAG)}`);
  assets = (again.json && again.json.assets) || assets;
  const targets = assets
    .filter((a) => /\.(zip|tgz)$/i.test(a.name) && a.digest)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => ({ name: a.name, digest: String(a.digest).replace(/^sha256:/i, "").toUpperCase() }));
  if (!targets.length) { console.log(JSON.stringify({ ...out, error: "no digests available for zip/tgz assets" }, null, 2)); process.exit(1); }
  const sums = targets.map((t) => t.digest + "  " + t.name).join("\n") + "\n";
  const old = assets.find((a) => a.name === "SHA256SUMS.txt");
  if (old) {
    const del = await api("DELETE", `/releases/assets/${old.id}`);
    out.deletedSums = del.status;
  }
  const sumsUpload = await request("POST", "uploads.github.com", `/repos/${REPO}/releases/${rel.id}/assets?name=SHA256SUMS.txt`, Buffer.from(sums, "utf8"));
  out.sums = { status: sumsUpload.status, lines: targets.length, bytes: sums.length, names: targets.map((t) => t.name) };

  // 3) 发布说明：CHANGELOG 段落 + 安装/校验模板（引用真实资产名）
  const names = assets.map((a) => a.name);
  const body = renderBody(
    names.find((n) => /\.tgz$/i.test(n)),
    names.find((n) => /\.zip$/i.test(n)),
  );
  const patched = await api("PATCH", `/releases/${rel.id}`, { body });
  out.body = { status: patched.status, bytes: body.length };

  // 4) 复核
  const finalRel = await api("GET", `/releases/tags/${encodeURIComponent(TAG)}`);
  if (finalRel.json) {
    out.finalAssets = (finalRel.json.assets || []).map((a) => ({ name: a.name, size: a.size, digest: a.digest }));
    out.finalBodyBytes = (finalRel.json.body || "").length;
    out.url = finalRel.json.html_url;
  }
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => {
  console.log(JSON.stringify({ error: String(e && e.message ? e.message : e) }, null, 2));
  process.exit(2);
});
