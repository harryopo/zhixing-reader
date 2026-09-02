/**
 * agent/history-summarizer — 历史滚动摘要器（Token 优化 Step 3）
 *
 * 长会话把滑动窗口外的更早轮次「增量摘要」为一段紧凑中文摘要，替代原文注入：
 *   - 输入：已有摘要 + 需并入的更早轮次原文
 *   - 输出：更新后的摘要（≤300 字），聚焦 用户目标 / 已确认事实 / 已做决定 / 未解决问题
 *   - 原则：绝不丢「事实/决定/承诺」；增量更新而非每次全量重算
 * 摘要调用走非流式补全（sdkGenerateText），用量以 feature='summary' 落库便于核算净节省。
 */
import { sdkGenerateText } from '../ai-sdk-service';
import { logger } from '../logger';

const SYSTEM_ROLE =
  '你是对话历史压缩器，负责把多轮对话压缩为简洁、事实准确的中文摘要，供后续对话作为上下文使用。';

/**
 * 增量滚动摘要。失败时保守降级返回已有摘要（不阻断对话主流程）。
 * @param existingSummary 已有摘要（首次为 null/空）
 * @param messages        需并入摘要的更早轮次原文
 * @param signal          可选中断信号（超时保护，避免摘要调用挂起阻塞对话）
 * @returns 更新后的摘要（无新内容或摘要失败时可能等于 existingSummary）
 */
export async function summarizeHistoryIncremental(
  existingSummary: string | null,
  messages: Array<{ role: string; content: string }>,
  signal?: AbortSignal,
): Promise<string> {
  const usable = messages.filter((m) => m.content && m.content.trim().length > 0);
  if (usable.length === 0) return existingSummary ?? '';

  const transcript = usable
    .map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content.trim()}`)
    .join('\n');

  const userPrompt = [
    existingSummary && existingSummary.trim()
      ? `已有摘要（在此基础上增量更新，保留其中的事实/决定/承诺，不要丢弃）：\n${existingSummary.trim()}`
      : '',
    `需要并入的更早对话轮次：\n${transcript}`,
    '请输出「更新后的完整摘要」，严格覆盖以下要点（无对应内容则省略该点），总长不超过 300 字：',
    '1) 用户目标；2) 已确认事实；3) 已做决定/承诺；4) 未解决问题。',
    '直接输出摘要正文，不要加标题、前缀或解释。',
  ]
    .filter((s) => s && s.trim())
    .join('\n\n');

  try {
    const summary = await sdkGenerateText(
      [
        { role: 'system', content: SYSTEM_ROLE },
        { role: 'user', content: userPrompt },
      ],
      { maxOutputTokens: 500, temperature: 0.3, feature: 'summary', signal },
    );
    const trimmed = summary.trim();
    if (!trimmed) return existingSummary ?? '';
    return trimmed;
  } catch (err) {
    logger.warn('History summarization failed, keeping existing summary', { error: String(err) });
    return existingSummary ?? '';
  }
}
