/**
 * ipc/knowledge — 方法论 / 知识卡片 / Skill 生成 handlers
 * 从原 ipc.ts 拆分而来，逻辑保持不变。
 */
import * as fs from 'fs';
import { dialog, BrowserWindow } from 'electron';
import { methodologiesDb, knowledgeCardsDb, highlightsDb, aiBatchesDb } from '../database';
import { logger } from '../logger';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { knowledgeCardService } from '../services/knowledge-card-service';
import { fetchAllContent } from '../weread-api';
import { planHighlightRows } from '../../src/shared/weread-content';
import { describeBookCoverage, pickUnprocessed } from '../../src/shared/ai-coverage';
import type { AiCoverageTask } from '../../src/shared/ai-coverage';
import { extractMethodologies } from '../ai-service';
import { generateCardInterpretation, generateCardApplication, generateSkill } from '../ai-sdk-service';
import type { HandleFn } from './types';

/**
 * 方法论 DB 记录 → generateSkill 入参。
 * SKILL.GENERATE / SKILL.EXPORT_FILE 共用，避免映射逻辑重复。
 * steps 是 JSON 字符串列，解析失败回退空数组（不抛错，避免 IPC 层崩溃）。
 */
function toSkillPayload(m: Record<string, unknown>, bookTitle: string) {
  let steps: string[] = []
  if (m.steps) {
    try {
      const parsed = JSON.parse(String(m.steps))
      if (Array.isArray(parsed)) steps = parsed.map(String)
    } catch {
      logger.warn('Failed to parse methodology steps for skill generation')
    }
  }
  return {
    name: String(m.name || ''),
    nameEn: m.name_en ? String(m.name_en) : undefined,
    triggerScenario: String(m.trigger_scenario || ''),
    description: String(m.description || ''),
    steps,
    outputFormat: String(m.output_format || ''),
    examples: String(m.examples || ''),
    bookTitle,
  }
}

/** 文件名安全化：剔除 Windows/macOS 非法字符并限长 */
function toSafeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
  return cleaned.slice(0, 60) || 'methodology'
}

export function registerKnowledgeHandlers(handle: HandleFn): void {
  handle(IPC_CHANNELS.METHODOLOGIES.GET_ALL, () => methodologiesDb.getAll());
  handle(IPC_CHANNELS.METHODOLOGIES.GET_BY_ID, (id: string) => methodologiesDb.getById(id));
  handle(IPC_CHANNELS.METHODOLOGIES.EXTRACT, async (bookId: string, bookTitle: string, replace?: boolean) => {
    let highlights = highlightsDb.getByBookId(bookId);

    if (!highlights || highlights.length === 0) {
      logger.info(`No highlights found for book "${bookTitle}", attempting to fetch from WeRead...`);
      try {
        const raw = await fetchAllContent(bookId);

        // 章节名、真实划线时间、摘句与想法的分栏，全在 planHighlightRows 那一处
        // （三条导入通路共用）。以前这里直接读划线条目自带的那个章节字段，而微信读书的
        // 划线接口经常不给章节名 ⇒ 实测 934 条 0 条有值。
        const rows = planHighlightRows(raw);
        let importedCount = 0;
        for (const row of rows) {
          try {
            // 只数真插进去的那几条：create 判重时回 false，连 false 也一起 +1 就是虚报
            if (highlightsDb.create({ book_id: bookId, ...row })) importedCount++;
          } catch (e) { logger.error('导入划线失败:', e); }
        }
        logger.info('自动导入笔记完成', { bookId, scanned: rows.length, importedCount });

        highlights = highlightsDb.getByBookId(bookId);
      } catch (error) {
        logger.error('自动导入笔记失败:', error);
        throw new Error(`自动导入笔记失败: ${error instanceof Error ? error.message : String(error)}`);
      }

      // 这道闸排在 try 外面：库里和微信读书都没有笔记是「没数据」，
      // 不是「导入失败」—— 混在一起报会让人以为是接口坏了。
      if (!highlights || highlights.length === 0) {
        throw new Error('该书在微信读书中也没有笔记，无法提取方法论');
      }
    }

    const mappedHighlights = highlights.map(h => ({
      // id 用于把提取出的方法论溯源回具体划线（2026-09-16 新增）
      id: h.id ? String(h.id) : undefined,
      content: String(h.content || ''),
      note: h.note ? String(h.note) : undefined,
      chapterTitle: h.chapter_title ? String(h.chapter_title) : undefined,
    }));
    // 分批续跑：只喂台账里没记过的那批。
    // 两种情况从头再来：replace（用户明说重来）、这本书已经没有任何成品（旧台账作废）。
    const existingItems = methodologiesDb.getCountsByBook()[bookId] ?? 0;
    const fromScratch = replace === true || existingItems === 0;
    if (existingItems === 0) aiBatchesDb.clear(bookId, 'methodologies');
    const processedIds = fromScratch
      ? new Set<string>()
      : new Set(aiBatchesDb.getProcessedIds(bookId, 'methodologies'));
    const { selected, plan: coverage } = pickUnprocessed(
      'methodologies',
      mappedHighlights,
      processedIds,
      (h) => h.id,
    );

    if (selected.length === 0) {
      // 整本书都提取过了：一次 AI 都不发
      return { methodologies: [], coverage, nothingNew: true };
    }

    const methodologies = await extractMethodologies(selected, bookTitle);

    // 「重新提取」= 替换：AI 成功了才删旧数据，避免把用户已有方法论弄没
    if (replace === true) {
      const removed = methodologiesDb.deleteByBookId(bookId);
      // 成品清空了，旧台账同时作废，否则两边对不上
      aiBatchesDb.clear(bookId, 'methodologies');
      logger.info(`重新提取：已清除旧方法论 ${removed} 条`, { bookId, bookTitle });
    }

    const results = [];
    for (const m of methodologies) {
      const id = `meth_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      methodologiesDb.create({
        id,
        book_id: bookId,
        name: m.name,
        name_en: m.nameEn,
        trigger_scenario: m.triggerScenario,
        description: m.description,
        steps: m.steps,
        output_format: m.outputFormat,
        examples: m.examples,
        tags: [],
        // 由 AI 给出的 sourceIndexes 换算而来；AI 没给则为空数组，**不猜**
        source_highlight_ids: m.sourceHighlightIds ?? [],
        mastery_level: 0,
        practice_count: 0,
      });
      results.push({ id, ...m });
    }
    // 方法论落库成功了才记台账 —— 半途失败时这批仍算"没处理过"，下次点还能补上
    aiBatchesDb.record(
      bookId,
      'methodologies',
      selected.map((h) => h.id).filter((id): id is string => Boolean(id)),
    );
    return { methodologies: results, coverage, nothingNew: false };
  });

  /**
   * 每本书的 AI 生成进度：分母是这本书的划线总数，分子是批次台账里记下的已处理数。
   * 一次查询取全（不按书循环查），列表页拿到的是「还能再生成多少条」。
   */
  function buildCoverage(feature: AiCoverageTask) {
    const totals = highlightsDb.getCountsByBook();
    const ledger = aiBatchesDb.getProcessedCounts(feature);
    const items =
      feature === 'knowledgeCards'
        ? knowledgeCardsDb.getCountsByBook()
        : methodologiesDb.getCountsByBook();
    return Object.entries(totals).map(([bookId, total]) => ({
      bookId,
      ...describeBookCoverage(total, ledger[bookId] ?? 0, items[bookId] ?? 0),
    }));
  }

  handle(IPC_CHANNELS.METHODOLOGIES.COVERAGE, () => buildCoverage('methodologies'));
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.COVERAGE, () => buildCoverage('knowledgeCards'));

  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.GET_ALL, () => knowledgeCardsDb.getAll());
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.UPDATE, (id: string, card: Record<string, unknown>) => knowledgeCardsDb.update(id, card));
  // 一次性找回历史卡片的来源划线（内容精确相等才算，不猜）
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.BACKFILL_SOURCE, () => ({
    updated: knowledgeCardsDb.backfillSourceHighlights(),
  }));
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.DISTILL, (bookId: string, bookTitle: string, replace?: boolean) =>
    knowledgeCardService.distillBook(bookId, bookTitle, { replace: replace === true })
  );
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.CANCEL_DISTILL, (bookId: string) => {
    const cancelled = knowledgeCardService.cancelDistill(bookId);
    return { success: cancelled };
  });
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.GENERATE_INTERPRETATION, async (bookTitle: string, cardTitle: string, cardContent: string, cardType: string) => {
    const text = await generateCardInterpretation(bookTitle, cardTitle, cardContent, cardType);
    return { text };
  });
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.GENERATE_APPLICATION, async (bookTitle: string, cardTitle: string, cardContent: string, cardType: string) => {
    const text = await generateCardApplication(bookTitle, cardTitle, cardContent, cardType);
    return { text };
  });


  // 生成 Skill 并弹保存对话框写盘（方法论详情页「导出为 Skill」）
  handle(IPC_CHANNELS.SKILL.EXPORT_FILE, async (methodologyId: string, bookTitle: string) => {
    const methodology = methodologiesDb.getById(methodologyId);
    if (!methodology) {
      throw new Error('方法论不存在');
    }

    // 先问存哪儿，再花 AI 的钱：旧顺序是「先生成再弹框」，用户点一下取消，
    // 这一次调用照样计费，而界面上只留下一句"已取消"。
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showSaveDialog(win, {
      title: '导出为 Skill',
      defaultPath: `${toSafeFileName(String(methodology.name || '方法论'))}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) {
      return { saved: false };
    }

    const content = await generateSkill(toSkillPayload(methodology, bookTitle));
    fs.writeFileSync(result.filePath, content, 'utf8');
    logger.info('Skill exported to file', { methodologyId, path: result.filePath });
    return { saved: true, path: result.filePath };
  });

}
