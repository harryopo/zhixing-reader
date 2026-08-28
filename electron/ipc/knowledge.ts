/**
 * ipc/knowledge — 方法论 / 知识卡片 / 书籍架构 / Skill 生成 handlers
 * 从原 ipc.ts 拆分而来，逻辑保持不变。
 */
import { methodologiesDb, knowledgeCardsDb, bookArchitectureDb, highlightsDb } from '../database';
import { logger } from '../logger';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { knowledgeCardService } from '../services/knowledge-card-service';
import { fetchAllContent } from '../weread-api';
import { extractMethodologies, analyzeBookArchitecture, generateCardInterpretation, generateCardApplication, generateSkill, generateSkillBatch } from '../ai-service';
import type { HandleFn } from './types';

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
  handle(IPC_CHANNELS.METHODOLOGIES.EXTRACT, async (bookId: string, bookTitle: string) => {
    let highlights = highlightsDb.getByBookId(bookId);

    if (!highlights || highlights.length === 0) {
      logger.info(`No highlights found for book "${bookTitle}", attempting to fetch from WeRead...`);
      try {
        const content = await fetchAllContent(bookId) as {
          bookmarks: Array<{ bookmarkId: string; chapterTitle: string; markText: string; chapterUid: number; createTime: number }>;
          notes: Array<{ reviewId: string; chapterTitle: string; abstract: string; content: string; chapterUid: number; createTime: number }>;
        };

        let _importedCount = 0;
        if (content.bookmarks && content.bookmarks.length > 0) {
          for (const bm of content.bookmarks) {
            try {
              highlightsDb.create({
                book_id: bookId,
                content: bm.markText,
                chapter_title: bm.chapterTitle,
                chapter_uid: bm.chapterUid,
                type: 'highlight',
                source: 'weread',
                created_at: new Date(bm.createTime * 1000).toISOString(),
              });
              _importedCount++;
            } catch (e) { logger.error('导入划线失败:', e); }
          }
        }
        if (content.notes && content.notes.length > 0) {
          for (const note of content.notes) {
            try {
              highlightsDb.create({
                book_id: bookId,
                content: note.abstract,
                note: note.content,
                chapter_title: note.chapterTitle,
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
      content: String(h.content || ''),
      note: h.note ? String(h.note) : undefined,
      chapterTitle: h.chapter_title ? String(h.chapter_title) : undefined,
    }));
    const methodologies = await extractMethodologies(mappedHighlights, bookTitle);
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
        source_highlight_ids: [],
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
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.DISTILL, (bookId: string, bookTitle: string) =>
    knowledgeCardService.distillBook(bookId, bookTitle)
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

  handle(IPC_CHANNELS.BOOK_ARCHITECTURE.GET_BY_BOOK, (bookId: string) => bookArchitectureDb.getByBookId(bookId));
  handle(IPC_CHANNELS.BOOK_ARCHITECTURE.CREATE, (architecture: Record<string, unknown>) => {
    const id = (architecture.id as string) || `arch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    bookArchitectureDb.create({ ...architecture, id });
    return { id };
  });
  handle(IPC_CHANNELS.BOOK_ARCHITECTURE.UPDATE, (id: string, architecture: Record<string, unknown>) => bookArchitectureDb.update(id, architecture));
  handle(IPC_CHANNELS.BOOK_ARCHITECTURE.DELETE, (id: string) => bookArchitectureDb.delete(id));
  handle(IPC_CHANNELS.BOOK_ARCHITECTURE.ANALYZE, async (bookId: string, bookTitle: string) => {
    const highlights = highlightsDb.getByBookId(bookId);
    if (!highlights || highlights.length === 0) {
      throw new Error('该书没有笔记，无法分析架构');
    }
    const mappedHighlights = highlights.map(h => ({
      content: String(h.content || ''),
      note: h.note ? String(h.note) : undefined,
      chapterTitle: h.chapter_title ? String(h.chapter_title) : undefined,
    }));
    const architecture = await analyzeBookArchitecture(mappedHighlights, bookTitle);
    const id = `arch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    bookArchitectureDb.create({
      id,
      book_id: bookId,
      core_proposition: architecture.coreProposition,
      cognitive_framework: architecture.cognitiveFramework,
      methodology_architecture: architecture.methodologyArchitecture,
      knowledge_hierarchy: architecture.knowledgeHierarchy,
      target_audience: architecture.targetAudience,
    });
    return { id, ...architecture };
  });

  handle(IPC_CHANNELS.SKILL.GENERATE, async (methodologyId: string, bookTitle: string, _author?: string) => {
    const methodology = methodologiesDb.getById(methodologyId);
    if (!methodology) {
      throw new Error('方法论不存在');
    }
    const skillContent = await generateSkill({
      name: String(methodology.name || ''),
      nameEn: methodology.name_en ? String(methodology.name_en) : undefined,
      triggerScenario: String(methodology.trigger_scenario || ''),
      description: String(methodology.description || ''),
      steps: methodology.steps ? JSON.parse(String(methodology.steps)) : [],
      outputFormat: String(methodology.output_format || ''),
      examples: String(methodology.examples || ''),
      bookTitle: bookTitle,
    });
    return { content: skillContent };
  });

  handle(IPC_CHANNELS.SKILL.EXPORT_BATCH, async (methodologyIds: string[], bookTitle: string, _author?: string) => {
    const methodologies = [];
    for (const id of methodologyIds) {
      const m = methodologiesDb.getById(id);
      if (m) methodologies.push(m);
    }
    const mapped = methodologies.map(m => ({
      name: String(m.name || ''),
      nameEn: m.name_en ? String(m.name_en) : undefined,
      triggerScenario: String(m.trigger_scenario || ''),
      description: String(m.description || ''),
      steps: m.steps ? JSON.parse(String(m.steps)) : [],
      outputFormat: String(m.output_format || ''),
      examples: String(m.examples || ''),
      bookTitle: bookTitle,
    }));
    const skills = await generateSkillBatch(mapped);
    return skills;
  });
}
