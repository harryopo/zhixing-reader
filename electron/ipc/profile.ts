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
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { describeCorpus, planCorpusRecords, planVolumes } from '../../src/shared/profile-corpus';
import type { CorpusPlan, CorpusVolume } from '../../src/shared/profile-corpus';
import { buildManifest, describeManifest } from '../../src/shared/profile-manifest';
import type { CorpusExportResult, ProfileManifest } from '../../src/shared/profile-manifest';
import { booksDb, conversationDb, dailyStatsDb, highlightsDb, memoriesDb } from '../database';
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

/** 导出包根目录名：带日期，重复导出不互相盖 */
export function packageDirName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `zhixing-profile-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

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
  const dir = join(root, packageDirName(now), 'corpus');
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
}
