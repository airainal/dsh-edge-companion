// headless 回退门禁：one-shot runner 不支持桌面会话的 agent preset（例如 cordis），
// 这类会话只能由桌面 DSH 客户端续接；否则会报
// "runs under agent preset ... which the one-shot runner does not compose"。
/** @returns {string} 非空表示禁止 headless 续接的原因 */
export function headlessResumeBlocker(header) {
  const preset = header && header.agentPreset ? String(header.agentPreset) : "";
  if (!preset) return "";
  return `该会话使用 agent preset「${preset}」，headless one-shot 不能续接`;
}
