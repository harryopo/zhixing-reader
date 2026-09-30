/**
 * ipc/profile — 阅读画像语料包
 *
 * 只做三件事：读本地库 → 交给 `src/shared/profile-corpus.ts` 分层 → 写盘。
 * **一次 AI 调用都不发**：画像的"总结"由外部 AI 做（维护者 2026-09-29 决定），
 * 应用只负责把证据如实搬出去。
 *
 * 顺序是"先问存哪儿、再取数写盘" —— 与 SKILL.EXPORT_FILE 那批同一条口径：
 * 反过来做的话用户点了取消，前面的取数全白干，磁盘上还多一个空目录。
 *
 * 读库失败**往外抛**，不在这里演成"没有语料"（本项目反复治的那个形状）。
 */
import { BrowserWindow, dialog } from 'electron';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { describeCorpus, planCorpusRecords, planVolumes } from '../../src/shared/profile-corpus';
import type { CorpusPlan, CorpusVolume } from '../../src/shared/profile-corpus';
import { buildManifest, describeManifest } from '../../src/shared/profile-manifest';
import type { CorpusExportResult, ProfileManifest } from '../../src/shared/profile-manifest';
import { buildHandoffDoc } from '../../src/shared/profile-handoff';
import { README_FILE_NAME, SKILL_DESCRIPTION, SKILL_DIR_NAME, SKILL_FILE_NAME, buildSkillFile } from '../../src/shared/profile-skill';
import {
  STATEMENT_FILE_LABEL,
  STATEMENT_VERDICTS,
  describeBadFile,
  describeStatementImport,
  highlightIdOfCorpusId,
  mergeStatementsForWrite,
  parseStatementsFile,
  validateStatements,
} from '../../src/shared/profile-statements';
import type {
  EvidenceText,
  StatementImportResult,
  StatementListView,
  StatementVerdict,
  StatementWritePlan,
} from '../../src/shared/profile-statements';
import { booksDb, conversationDb, dailyStatsDb, highlightsDb, memoriesDb, profileStatementsDb } from '../database';
import { getUserSelfProfile } from '../services/user-profile-service';
import { logger } from '../logger';
import type { HandleFn } from './types';

/**
 * 每卷的上限（字）。marked 层本机实测 56,299 字，一次喂进去既超常见上下文，
 * 也正是 OP-Bench 测出「记忆反而拖垮表现」的那种用法 —— 所以按卷切，让人挑着贴。
 */
export const CORPUS_MAX_CHARS_PER_VOLUME = 4000;

/** 日粒度数据取全史：`daily_stats.date` 是 `YYYY-MM-DD`，两头各给一个不会越界的哨兵值 */
const ALL_DAYS: [string, string] = ['0001-01-01', '9999-12-31'];

/** 你自己打进对话的话取最近这么多条（再早的一般已经和当前画像无关） */
const USER_MESSAGE_LIMIT = 500;

/** 我们自己写出去的那些卷的命名 —— 清理旧卷时只认这个形状，别的一个不碰 */
const VOL_FILE = /^[a-z]+-vol-\d{2}\.jsonl$/;

/**
 * 包目录名 = Skill 的 `name`（Agent Skills 要求两者一字不差，不等时客户端**静默不加载**）。
 * 带日期的目录名在这套规范下没有意义 —— 外部工具按目录名找入口，而日期每次变。
 * 所以目录固定，`manifest.json` 里的 `generated_at` 说清这一批是哪一刻的快照；
 * 重导出走的是同一份清理（旧卷摘掉、说明覆盖），是沉淀不是攒副本。
 * 名字只有一个出处：`SKILL_DIR_NAME`。
 */
export const PACKAGE_DIR_NAME = SKILL_DIR_NAME;

/** 六摊数据一次读齐，交给纯函数分层 —— 归层的规则一条都不在这儿 */
export function collectCorpusPlan(): CorpusPlan {
  return planCorpusRecords({
    highlights: highlightsDb.getAll(),
    books: booksDb.getAll(),
    userMessages: conversationDb.getUserMessages(USER_MESSAGE_LIMIT),
    memories: memoriesDb.getAll(),
    dailyStats: dailyStatsDb.getRange(ALL_DAYS[0], ALL_DAYS[1]),
    selfProfile: getUserSelfProfile(),
    highlightCountsByBook: highlightsDb.getCountsByBook(),
  });
}

/**
 * 写盘：manifest.json + 每卷一个 jsonl。
 *
 * manifest 在这里算**一次**，既写盘又据它拼界面那句 —— 两处各算一份迟早出现
 * 「界面上报的数与文件里的数不一样」。逐行 `JSON.stringify`：外部 AI 要能一行一条地读，
 * 而整卷一个 JSON 数组的话，坏一行就整卷解析不出来。
 */
export function writeCorpusPackage(
  root: string,
  plan: CorpusPlan,
  volumes: readonly CorpusVolume[],
  now: Date,
): { dir: string; manifest: ProfileManifest } {
  const packageRoot = join(root, PACKAGE_DIR_NAME);
  const dir = join(packageRoot, 'corpus');
  mkdirSync(dir, { recursive: true });
  const manifest = buildManifest({ plan, volumes, now });
  // 上一次导出留下的旧卷要先摘掉：外部 AI 是照着目录读文件的，留着 marked-vol-07
  // 就是把已经删掉的划线当成还在。只摘我们自己那个命名（`*-vol-NN.jsonl`），
  // 用户放在同一目录里的别的文件一个都不碰。
  const keep = new Set(volumes.map((volume) => volume.file));
  for (const name of readdirSync(dir)) {
    if (VOL_FILE.test(name) && !keep.has(name)) rmSync(join(dir, name));
  }
  for (const volume of volumes) {
    const lines = volume.records.map((record) => JSON.stringify(record));
    writeFileSync(join(dir, volume.file), `${lines.join('\n')}\n`, 'utf8');
  }
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  // 交接说明与语料同批写出：一份散文，两个入口文件名（README 给人和其他工具翻，
  // SKILL.md 给按 Agent Skills 认目录的那批客户端）。**正文同一个字符串**，
  // 所以两处不可能各说一套 —— 判据逐字节对账这条。
  const doc = buildHandoffDoc(manifest);
  writeFileSync(join(packageRoot, README_FILE_NAME), doc, 'utf8');
  writeFileSync(
    join(packageRoot, SKILL_FILE_NAME),
    buildSkillFile({ name: PACKAGE_DIR_NAME, description: SKILL_DESCRIPTION, body: doc }),
    'utf8',
  );
  return { dir, manifest };
}

export function registerProfileHandlers(handle: HandleFn): void {
  handle(IPC_CHANNELS.PROFILE.EXPORT_PACKAGE, async (): Promise<CorpusExportResult> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const picked = await dialog.showOpenDialog(win, {
      title: '导出阅读画像语料包',
      buttonLabel: '导出到这里',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (picked.canceled || picked.filePaths.length === 0) {
      return { saved: false, summary: '已取消，磁盘上没有动', dir: '', volumes: 0, reason: 'canceled' };
    }

    // 取数排在保存框之后：取消时一次库都不读、一个目录都不建
    const plan = collectCorpusPlan();
    if (plan.records.length === 0) {
      // 空语料不写盘 —— 导一个空包出去，外部 AI 只能凭猜测编一个人
      return { saved: false, summary: describeCorpus(plan), dir: '', volumes: 0, reason: 'empty' };
    }

    const volumes = planVolumes(plan.records, CORPUS_MAX_CHARS_PER_VOLUME);
    const { dir, manifest } = writeCorpusPackage(picked.filePaths[0], plan, volumes, new Date());
    logger.info('Profile corpus exported', { dir, volumes: volumes.length, records: plan.records.length });
    return { saved: true, summary: describeManifest(manifest), dir, volumes: volumes.length };
  });

  /**
   * 核验区一次读全：结论 + 每条证据的原话。
   *
   * 证据原文取的是**与导出同一个出处**（`collectCorpusPlan` 交回的那批记录）：
   * 导入那道闸认的 id 集就是它，这里再算一遍别处读法，早晚会漂成"闸收了的 id 界面读不出原文"。
   */
  handle(IPC_CHANNELS.PROFILE.LIST_STATEMENTS, (): StatementListView => {
    const statements = profileStatementsDb.getAll();
    const wanted = new Set(statements.flatMap((row) => row.evidenceIds));
    const evidence: Record<string, EvidenceText> = {};
    // 没有结论可摆 ⇒ 一次语料都不读。核验区刚进应用时库里是空的，
    // 读一整套六摊数据只为交回一个空表，是白读。
    if (wanted.size > 0) {
      for (const record of collectCorpusPlan().records) {
        if (!wanted.has(record.id)) continue;
        const item: EvidenceText = { text: record.text };
        if (record.bookId) item.bookId = record.bookId;
        if (record.bookTitle) item.bookTitle = record.bookTitle;
        if (record.kind === 'highlight' || record.kind === 'highlight_note') {
          item.highlightId = highlightIdOfCorpusId(record.id);
        }
        evidence[record.id] = item;
      }
    }
    return { statements, evidence };
  });

  /**
   * 导入外部 AI 写的结论清单。
   *
   * 顺序仍是**先问文件、再读库**（与 `EXPORT_PACKAGE` 同一条口径）：用户点取消时
   * 一次库都不读。读文件失败**往外抛** —— 不演成"这份文件没有结论"。
   */
  handle(IPC_CHANNELS.PROFILE.IMPORT_STATEMENTS, async (): Promise<StatementImportResult> => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const picked = await dialog.showOpenDialog(win, {
      title: '导入画像结论清单',
      buttonLabel: '导入这一份',
      properties: ['openFile'],
      filters: [{ name: STATEMENT_FILE_LABEL, extensions: ['json'] }],
    });
    if (picked.canceled || picked.filePaths.length === 0) {
      return { saved: false, summary: '已取消，库里什么都没改', written: 0, reason: 'canceled' };
    }

    const text = readFileSync(picked.filePaths[0], 'utf8');
    const parsed = parseStatementsFile(text);
    if (!parsed.ok) {
      return { saved: false, summary: describeBadFile(parsed.reason), written: 0, reason: 'bad_file' };
    }

    const knownIds = new Set(collectCorpusPlan().records.map((record) => record.id));
    const { accepted, rejected } = validateStatements(parsed.file.statements, knownIds, parsed.file.origin);
    for (const item of rejected) logger.warn('Profile statement rejected on import', item);

    const existing: Record<string, { verdict: StatementVerdict }> = {};
    for (const row of profileStatementsDb.getAll()) existing[row.id] = { verdict: row.verdict };
    const merged = mergeStatementsForWrite(accepted, existing);
    const plan: StatementWritePlan = { ...merged, rejected };

    if (merged.toWrite.length === 0) {
      // 库里一格没动：可能全被闸挡下，也可能全是你已经判过的 —— summary 里分得开这两种
      return { saved: false, summary: describeStatementImport(plan), written: 0, reason: 'nothing_accepted' };
    }

    const written = profileStatementsDb.upsertMany(merged.toWrite);
    logger.info('Profile statements imported', { written, protected: merged.protectedIds.length, rejected: rejected.length });
    return { saved: true, summary: describeStatementImport(plan), written };
  });

  /**
   * 按下「对 / 不对 / 不确定」。只认那四个取值 —— 传进来别的形状不掰成判定
   * （`{}` 被当成"用户按过了"是本项目在 IPC 边界治过多次的假成功）。
   */
  handle(IPC_CHANNELS.PROFILE.SET_STATEMENT_VERDICT, (id: unknown, verdict: unknown): { recorded: boolean } => {
    const key = typeof id === 'string' ? id.trim() : '';
    if (!key) throw new Error('没有结论编号，改不了判定');
    if (!STATEMENT_VERDICTS.includes(verdict as StatementVerdict)) {
      throw new Error(`「${String(verdict)}」不是我认的判定：只认 ${STATEMENT_VERDICTS.join(' / ')}`);
    }
    return { recorded: profileStatementsDb.setVerdict(key, verdict as StatementVerdict) };
  });
}
