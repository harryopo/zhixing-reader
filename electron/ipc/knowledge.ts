/**
 * ipc/knowledge — 方法论 / 知识卡片 / Skill 生成 handlers
 * 从原 ipc.ts 拆分而来，逻辑保持不变。
 */
import * as fs from 'fs';
import { dialog, BrowserWindow } from 'electron';
import { methodologiesDb, knowledgeCardsDb, highlightsDb } from '../database';
import { logger } from '../logger';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { knowledgeCardService } from '../services/knowledge-card-service';
import { fetchAllContent } from '../weread-api';
import { resolveWereadContent } from '../../src/shared/weread-content';
import { extractMethodologies, generateCardInterpretation, generateCardApplication, generateSkill } from '../ai-service';
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
  handle(IPC_CHANNELS.METHODOLOGIES.GET_BY_BOOK, (bookId: string) => methodologiesDb.getByBookId(bookId));
  handle(IPC_CHANNELS.METHODOLOGIES.CREATE, (methodology: Record<string, unknown>) => {
    const id = (methodology.id as string) || `meth_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    methodologiesDb.create({ ...methodology, id });
    return { id };
  });
  handle(IPC_CHANNELS.METHODOLOGIES.UPDATE, (id: string, methodology: Record<string, unknown>) => methodologiesDb.update(id, methodology));
  handle(IPC_CHANNELS.METHODOLOGIES.DELETE, (id: string) => methodologiesDb.delete(id));
  handle(IPC_CHANNELS.METHODOLOGIES.SEARCH, (keyword: string) => methodologiesDb.search(keyword));
  handle(IPC_CHANNELS.METHODOLOGIES.EXTRACT, async (bookId: string, bookTitle: string, replace?: boolean) => {
    let highlights = highlightsDb.getByBookId(bookId);

    if (!highlights || highlights.length === 0) {
      logger.info(`No highlights found for book "${bookTitle}", attempting to fetch from WeRead...`);
      try {
        const raw = await fetchAllContent(bookId) as {
          bookmarks: Array<{ bookmarkId: string; chapterTitle: string; markText: string; chapterUid: number; createTime: number }>;
          notes: Array<{ reviewId: string; chapterTitle: string; abstract: string; content: string; chapterUid: number; createTime: number }>;
          chapters?: Array<{ chapterUid: number; title: string; level?: number }>;
        };

        // 用共用的解析器补全章节名 —— 此前这里直接取 bm.chapterTitle，
        // 而微信读书划线接口经常不给章节名（要靠 chapters 对照表），
        // 结果渲染层、主进程三处导入全都写出空章节名（实测 934 条 0 条有值）。
        const { bookmarks, notes } = resolveWereadContent(raw);

        let _importedCount = 0;
        if (bookmarks.length > 0) {
          for (const bm of bookmarks) {
            try {
              highlightsDb.create({
                book_id: bookId,
                content: bm.markText,
                chapter_title: bm.resolvedChapterTitle,
                chapter_uid: bm.chapterUid,
                type: 'highlight',
                source: 'weread',
                created_at: new Date(bm.createTime * 1000).toISOString(),
              });
              _importedCount++;
            } catch (e) { logger.error('导入划线失败:', e); }
          }
        }
        if (notes.length > 0) {
          for (const note of notes) {
            try {
              highlightsDb.create({
                book_id: bookId,
                content: note.abstract,
                note: note.content,
                chapter_title: note.resolvedChapterTitle,
                chapter_uid: note.chapterUid,
                type: 'note',
                source: 'weread',
                created_at: new Date(note.createTime * 1000).toISOString(),
              });
              _importedCount++;
            } catch (e) { logger.error('导入笔记失败:', e); }
          }
        }

        highlights = highlightsDb.getByBookId(bookId);

        if (!highlights || highlights.length === 0) {
          throw new Error('该书在微信读书中也没有笔记，无法提取方法论');
        }
      } catch (error) {
        logger.error('自动导入笔记失败:', error);
        throw new Error(`自动导入笔记失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const mappedHighlights = highlights.map(h => ({
      // id 用于把提取出的方法论溯源回具体划线（2026-09-16 新增）
      id: h.id ? String(h.id) : undefined,
      content: String(h.content || ''),
      note: h.note ? String(h.note) : undefined,
      chapterTitle: h.chapter_title ? String(h.chapter_title) : undefined,
    }));
    const methodologies = await extractMethodologies(mappedHighlights, bookTitle);

    // 「重新提取」= 替换：AI 成功了才删旧数据，避免把用户已有方法论弄没
    if (replace === true) {
      const removed = methodologiesDb.deleteByBookId(bookId);
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
    return results;
  });

  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.GET_ALL, () => knowledgeCardsDb.getAll());
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.GET_BY_ID, (id: string) => knowledgeCardsDb.getById(id));
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.GET_BY_BOOK, (bookId: string) => knowledgeCardsDb.getByBookId(bookId));
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.GET_BY_TYPE, (type: string) => knowledgeCardsDb.getByType(type));
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.CREATE, (card: Record<string, unknown>) => {
    const id = (card.id as string) || `kc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    knowledgeCardsDb.create({ ...card, id });
    return { id };
  });
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.UPDATE, (id: string, card: Record<string, unknown>) => knowledgeCardsDb.update(id, card));
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.DELETE, (id: string) => knowledgeCardsDb.delete(id));
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.SEARCH, (keyword: string) => knowledgeCardsDb.search(keyword));
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
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.IS_DISTILLING, (bookId: string) =>
    knowledgeCardService.isDistilling(bookId)
  );
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.GENERATE_INTERPRETATION, async (bookTitle: string, cardTitle: string, cardContent: string, cardType: string) => {
    const text = await generateCardInterpretation(bookTitle, cardTitle, cardContent, cardType);
    return { text };
  });
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.GENERATE_APPLICATION, async (bookTitle: string, cardTitle: string, cardContent: string, cardType: string) => {
    const text = await generateCardApplication(bookTitle, cardTitle, cardContent, cardType);
    return { text };
  });

  handle(IPC_CHANNELS.SKILL.GENERATE, async (methodologyId: string, bookTitle: string, _author?: string) => {
    const methodology = methodologiesDb.getById(methodologyId);
    if (!methodology) {
      throw new Error('方法论不存在');
    }
    const skillContent = await generateSkill(toSkillPayload(methodology, bookTitle));
    return { content: skillContent };
  });

  // 生成 Skill 并弹保存对话框写盘（方法论详情页「导出为 Skill」）
  handle(IPC_CHANNELS.SKILL.EXPORT_FILE, async (methodologyId: string, bookTitle: string) => {
    const methodology = methodologiesDb.getById(methodologyId);
    if (!methodology) {
      throw new Error('方法论不存在');
    }
    const content = await generateSkill(toSkillPayload(methodology, bookTitle));

    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const result = await dialog.showSaveDialog(win, {
      title: '导出为 Skill',
      defaultPath: `${toSafeFileName(String(methodology.name || '方法论'))}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) {
      return { saved: false };
    }

    fs.writeFileSync(result.filePath, content, 'utf8');
    logger.info('Skill exported to file', { methodologyId, path: result.filePath });
    return { saved: true, path: result.filePath };
  });

}
