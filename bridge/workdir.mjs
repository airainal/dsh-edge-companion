// 会话工作目录解析：插件新建的会话必须落在客户端已注册的 workspace 里，
// 否则客户端会话列表看不到它（旧行为落到 %USERPROFILE%\.dsh\profiles\desktop 就是这个问题）。
import fs from "node:fs";
import path from "node:path";

/** 规范化路径用于比较：去尾部分隔符、统一小写（Windows 不区分大小写）。 */
export function normCwd(value) {
  return String(value || "").replace(/[\\/]+$/, "").toLowerCase();
}

/**
 * 读取 DSH workspace 注册表。
 * @returns {{ defaultPath: string, paths: string[], normalized: Set<string> }}
 */
export function readWorkspaces(dshHome) {
  try {
    const file = path.join(dshHome, "storages", "workspace.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    const table = (state && state.tables && state.tables.workspaces) || {};
    const defaultId = state && state.global && state.global.defaultWorkspaceId;
    const paths = Object.values(table)
      .map((row) => (row && row.path ? String(row.path) : ""))
      .filter(Boolean);
    const defaultPath = defaultId && table[defaultId] && table[defaultId].path ? String(table[defaultId].path) : "";
    return { defaultPath, paths, normalized: new Set(paths.map(normCwd).filter(Boolean)) };
  } catch {
    return { defaultPath: "", paths: [], normalized: new Set() };
  }
}

/**
 * 选一个"客户端认识的"工作目录：
 * 1) 当前跟随会话的 cwd（必须已注册）；
 * 2) 默认 workspace 的 path；
 * 3) 任一已注册 workspace；
 * 4) 空串 —— 交给宿主默认目录，且调用方应提示这是降级。
 * 注意：绝不能退回"最近会话 cwd"，因为旧插件创建的会话本身就在 profile 目录里。
 */
export function resolveWorkdir({ dshHome, sessions = [], sessionId = "" } = {}) {
  const reg = readWorkspaces(dshHome);
  const id = String(sessionId || "");
  if (id) {
    const row = (sessions || []).find((s) => s && String(s.sessionId || "") === id);
    const cwd = row && row.cwd ? String(row.cwd) : "";
    if (cwd && (!reg.normalized.size || reg.normalized.has(normCwd(cwd)))) return cwd;
  }
  if (reg.defaultPath) return reg.defaultPath;
  if (reg.paths.length) return String(reg.paths[0]);
  return "";
}
