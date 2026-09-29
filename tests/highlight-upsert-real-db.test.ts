// highlightsDb.create 的"同一句已存在时该怎么办"——真库测试
//
// 2026-09-29 立。起因是给「个人画像」准备一手语料时读出来的：库里已经那句话、
// 而这一趟带回了用户写的想法时，`create` 撞 (book_id, content) 判重直接 return false
// ⇒ 想法永远进不来，而界面那句"导入完成"说的还是成功的。
// 渲染层 import-weread-content 自己另写了一份按 content 判重的 pre-check
// （只补章节名、从不补想法）—— 同一条"什么算同一行"的规则有两份实现，
// 正是本项目反复出事的那个形状（字段清单 → 章节名 → 时间口径 → 这里）。
// 所以把"已存在时补什么"收进 create 一处，并让它交回三个各自独立的计数。
//
// 只 mock 日志：判据量的是"库里那一行到底变成什么了"。

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers';
import { getDatabase, highlightsDb } from '../electron/database';

vi.mock('../electron/logger', () => ({
  logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

function seedBook(id: string, title: string): void {
  getDatabase().run('INSERT INTO books (id, title) VALUES (?, ?)', [id, title]);
}

function stored(id: string): Record<string, unknown> {
  const exec = getDatabase().exec('SELECT * FROM highlights WHERE id = ?', [id]);
  if (exec.length === 0) throw new Error(`库里没有这一行：${id}`);
  const out: Record<string, unknown> = {};
  exec[0].columns.forEach((col, i) => { out[col] = exec[0].values[0][i]; });
  return out;
}

beforeAll(async () => {
  // 夹具复用生产的 applySchemaAndMigrations()：schema 只有一份真值
  await setupTestDatabase();
  seedBook('bk1', '被讨厌的勇气');
  seedBook('bk2', '当下的力量');
});

beforeEach(() => {
  getDatabase().run('DELETE FROM highlights');
});

afterAll(() => teardownTestDatabase());

describe('create 交回的三个计数各归各的（新增 / 补上想法 / 补上章节名）', () => {
  it('库里没有这句 ⇒ created 亮、两个补全都不亮', () => {
    expect(highlightsDb.create({ id: 'a', book_id: 'bk1', content: '第一句' })).toEqual({
      created: true, noteFilled: false, chapterFilled: false,
    });
  });

  it('库里已有这句、还没有想法，这趟带回想法 ⇒ 补进同一行并说"补上了想法"', () => {
    highlightsDb.create({ id: 'a', book_id: 'bk1', content: '人的烦恼皆源于人际关系' });

    expect(
      highlightsDb.create({ id: 'b', book_id: 'bk1', content: '人的烦恼皆源于人际关系', note: '明天就用这句沟通' })
    ).toEqual({ created: false, noteFilled: true, chapterFilled: false });

    expect(stored('a').note).toBe('明天就用这句沟通');
    // 补写走的是同一行：既不多出一条重复的原文，也不把原来那条挪走
    expect(highlightsDb.getAll().filter((h) => h.content === '人的烦恼皆源于人际关系')).toHaveLength(1);
  });

  it('库里已有这句、想法也有 ⇒ 不覆盖用户原来写的，三个计数全不亮', () => {
    highlightsDb.create({ id: 'a', book_id: 'bk1', content: '同一句', note: '我自己写的想法' });

    expect(
      highlightsDb.create({ id: 'b', book_id: 'bk1', content: '同一句', note: '接口又回了一遍' })
    ).toEqual({ created: false, noteFilled: false, chapterFilled: false });

    // 库里那条是用户自己写的 ⇒ 任何自动导入都不许把它换成接口回来的那份
    expect(stored('a').note).toBe('我自己写的想法');
  });

  it('库里章节名是空的、这趟能解析出来 ⇒ 补章节名', () => {
    highlightsDb.create({ id: 'a', book_id: 'bk1', content: '同一句', chapter_title: null });

    expect(
      highlightsDb.create({ id: 'b', book_id: 'bk1', content: '同一句', chapter_title: '第二章' })
    ).toEqual({ created: false, noteFilled: false, chapterFilled: true });

    expect(stored('a').chapter_title).toBe('第二章');
  });

  it('想法与章节名都缺 ⇒ 一趟同时补两个，两个计数都亮', () => {
    highlightsDb.create({ id: 'a', book_id: 'bk1', content: '同一句' });

    expect(
      highlightsDb.create({ id: 'b', book_id: 'bk1', content: '同一句', note: '想法', chapter_title: '第三章' })
    ).toEqual({ created: false, noteFilled: true, chapterFilled: true });

    expect(stored('a')).toMatchObject({ note: '想法', chapter_title: '第三章' });
  });

  it('只有空格的"想法"不算想法 ⇒ 不许写进库里冒充用户写的', () => {
    highlightsDb.create({ id: 'a', book_id: 'bk1', content: '同一句' });

    expect(
      highlightsDb.create({ id: 'b', book_id: 'bk1', content: '同一句', note: '   \n ' })
    ).toEqual({ created: false, noteFilled: false, chapterFilled: false });

    expect(stored('a').note).toBeNull();
  });

  it('判重只认同一本书：另一本书里的同一句照建', () => {
    highlightsDb.create({ id: 'a', book_id: 'bk1', content: '同一句' });

    expect(
      highlightsDb.create({ id: 'b', book_id: 'bk2', content: '同一句', note: '另一本的想法' })
    ).toEqual({ created: true, noteFilled: false, chapterFilled: false });

    expect(stored('b').note).toBe('另一本的想法');
  });

  it('正文为空的想法不许互相顶掉：两页各写一条 ⇒ 两条都进库', () => {
    const one = highlightsDb.create({ id: 'a', book_id: 'bk1', content: '', note: '第一页的想法' });
    const two = highlightsDb.create({ id: 'b', book_id: 'bk1', content: '', note: '第二页的想法' });

    // 判重键是 (book_id, content)，正文为空时这个键对每条空正文行都一样 ⇒
    // 旧写法第二条会被当成重复丢掉，用户在页边写的想法就少一条
    expect(one.created).toBe(true);
    expect(two.created).toBe(true);
  });

  it('补写走的是活口 update 的列口径：库里那一行除这两列外一字不动', () => {
    const before = highlightsDb.create({
      id: 'a', book_id: 'bk1', content: '同一句', style: 3, created_at: '2024-05-01T00:00:00.000Z',
    });
    expect(before.created).toBe(true);

    highlightsDb.create({ id: 'b', book_id: 'bk1', content: '同一句', note: '想法', created_at: '2025-01-01T00:00:00.000Z' });

    // 划线时刻属于原来那一次划线，补想法不许把它挪到想法的时刻
    expect(stored('a')).toMatchObject({ style: 3 });
    expect(String(stored('a').created_at)).toContain('2024-05-01');
  });
});

describe('create 的兜底与既有语义不回退', () => {
  it('不给 id 就自己造一个（sql.js 绑不了 undefined，漏写就整批插不进去）', () => {
    const outcome = highlightsDb.create({ book_id: 'bk1', content: '没时间戳的一句' });
    expect(outcome.created).toBe(true);
    expect(highlightsDb.getAll().some((h) => String(h.id).startsWith('hl_'))).toBe(true);
  });

  it('created_at 给的是 ISO 带 T ⇒ 落成库里那个第 10 位是空格的形状', () => {
    highlightsDb.create({ id: 'a', book_id: 'bk1', content: '形状', created_at: '2024-05-01T08:00:00.000Z' });
    expect(String(stored('a').created_at)).toBe('2024-05-01 08:00:00');
  });

  it('解析不出来的时间不吃 DEFAULT 之外的任何编造值（不写 1970）', () => {
    highlightsDb.create({ id: 'a', book_id: 'bk1', content: '坏时间', created_at: '不是时间' });
    expect(String(stored('a').created_at)).not.toContain('1970');
  });
});
