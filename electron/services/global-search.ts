/**
 * 全局搜索（主进程一次查完五类）
 *
 * 为什么不在渲染层拼五次：五类各发一条 IPC 会让结果页等五个来回，而且"哪些类算搜过、
 * 每类几条"这件事会在界面与数据库两侧各记一份 —— 本项目被这类双口径咬过不止一次。
 * 类名、每类上限、片段截法、链接拼法都在 `src/shared/global-search.ts` 那一份里。
 *
 * 值一律走 `?` 占位符；`%` 与 `_` 在 pattern 里已被转义，所以配套的 `ESCAPE '\'`
 * 一个字都不能少（少了转义就不生效，搜 `100%` 会命中所有行）。
 *
 * 列清单与筛选条件（`from` + `where`）由列出的行与 COUNT 共用一份 —— 分成两份写迟早
 * 漂成"报的数与给的行不是同一批"，那比不报更糟。
 */
import { getDatabase } from '../database/connection';
import { rowsToObjects } from '../utils/db';
import {
  SEARCH_GROUPS,
  buildHitLink,
  makeSnippet,
  toLikePattern,
  type GlobalSearchResult,
  type SearchGroupResult,
  type SearchGroupSpec,
  type SearchHit,
  type SearchKind,
} from '../../src/shared/global-search';

type Row = Record<string, unknown>;

interface KindSpec {
  kind: SearchKind;
  /** 要摆出来的列（含 JOIN 出来的书名等） */
  columns: string;
  /** FROM + JOIN，与 where 一起被行查询和 COUNT 查询共用 */
  from: string;
  /** 筛选条件，LIKE 的个数必须等于 pattern 用几次 */
  where: string;
  /** 列出哪几条：按时间倒序最贴近"我最近划的那句" */
  order: string;
  patternCount: number;
  /** 命中片段从哪些列里找（按顺序取第一个真含关键词的） */
  textColumns: string[];
  title: (row: Row) => string;
  meta: (row: Row) => string;
}

const LIKE = `LIKE ? ESCAPE '\\'`;
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

const SPECS: KindSpec[] = [
  {
    kind: 'highlight',
    columns: `h.id, h.book_id, h.content, h.note, h.chapter_title, b.title AS book_title`,
    from: `FROM highlights h JOIN books b ON h.book_id = b.id`,
    // 与笔记页那台筛选器搜同样的四个字段（正文 / 笔记 / 章名 / 书名）：
    // 这里少一列，「共 832 条」点过去就会变成「916 条」，两个数说的是两件事
    where: `h.content ${LIKE} OR h.note ${LIKE} OR h.chapter_title ${LIKE} OR b.title ${LIKE}`,
    order: 'h.created_at DESC',
    patternCount: 4,
    textColumns: ['content', 'note', 'chapter_title'],
    title: (r) => str(r.book_title),
    meta: (r) => str(r.chapter_title),
  },
  {
    kind: 'card',
    columns: `k.id, k.book_id, k.title, k.content, k.interpretation, k.type, b.title AS book_title`,
    from: `FROM knowledge_cards k JOIN books b ON k.book_id = b.id`,
    where: `k.title ${LIKE} OR k.content ${LIKE} OR k.interpretation ${LIKE}`,
    order: 'k.created_at DESC',
    patternCount: 3,
    textColumns: ['content', 'interpretation', 'title'],
    title: (r) => str(r.title),
    meta: (r) => str(r.book_title),
  },
  {
    kind: 'methodology',
    columns: `m.id, m.book_id, m.name, m.description, m.steps, m.trigger_scenario, b.title AS book_title`,
    from: `FROM methodologies m JOIN books b ON m.book_id = b.id`,
    where: `m.name ${LIKE} OR m.description ${LIKE} OR m.steps ${LIKE}`,
    order: 'm.created_at DESC',
    patternCount: 3,
    textColumns: ['description', 'steps', 'trigger_scenario', 'name'],
    title: (r) => str(r.name),
    meta: (r) => str(r.book_title),
  },
  {
    kind: 'article',
    columns: `id, title_zh, title_en, summary_zh, content_zh, content_en, difficulty, category`,
    from: 'FROM articles',
    where: `title_zh ${LIKE} OR title_en ${LIKE} OR summary_zh ${LIKE} OR content_zh ${LIKE}`,
    order: 'created_at DESC',
    patternCount: 4,
    textColumns: ['summary_zh', 'content_zh', 'title_zh', 'content_en', 'title_en'],
    title: (r) => str(r.title_zh) || str(r.title_en),
    meta: (r) => [str(r.difficulty), str(r.category)].filter(Boolean).join(' · '),
  },
  {
    kind: 'word',
    columns: `id, word, meaning_zh, example_zh, phonetic, cefr_level, part_of_speech`,
    from: 'FROM vocabulary',
    where: `word ${LIKE} OR meaning_zh ${LIKE}`,
    order: 'created_at DESC',
    patternCount: 2,
    textColumns: ['meaning_zh', 'example_zh', 'word'],
    title: (r) => str(r.word),
    meta: (r) =>
      [str(r.part_of_speech), str(r.cefr_level) && `CEFR ${str(r.cefr_level)}`]
        .filter(Boolean)
        .join(' · '),
  },
];

/** LIKE 的个数 == patternCount：多一个少一个都是把某一列漏搜了（或漏传了一个值） */
function assertLikeCount(spec: KindSpec): void {
  const needle = LIKE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const likes = (spec.where.match(new RegExp(needle, 'g')) ?? []).length;
  if (likes !== spec.patternCount) {
    throw new Error(
      `${spec.kind} 的筛选条件有 ${likes} 处 LIKE，与 patternCount=${spec.patternCount} 不符`,
    );
  }
}

/** 从若干列里挑第一个真含关键词的作为片段来源 */
function textFor(row: Row, spec: KindSpec, query: string): string {
  const needle = query.toLowerCase();
  for (const col of spec.textColumns) {
    const v = str(row[col]);
    if (v.toLowerCase().includes(needle)) return v;
  }
  return str(row[spec.textColumns[0]]);
}

function searchOne(group: SearchGroupSpec, spec: KindSpec, pattern: string, query: string): SearchGroupResult {
  assertLikeCount(spec);
  const params = [...Array<string>(spec.patternCount).fill(pattern)];
  const db = getDatabase();
  // 先数总数再取前几条：两个查询共用同一份 from + where，报的数与给的行必然同批
  const counted = db.exec(`SELECT COUNT(*) ${spec.from} WHERE ${spec.where}`, params);
  const matched = counted.length > 0 ? Number(counted[0].values[0][0]) : 0;
  const rows = rowsToObjects(
    db.exec(`SELECT ${spec.columns} ${spec.from} WHERE ${spec.where} ORDER BY ${spec.order} LIMIT ?`, [
      ...params,
      group.limit,
    ]),
  );
  const hits: SearchHit[] = rows.map((row) => {
    const id = str(row.id);
    const bookId = row.book_id === undefined || row.book_id === null ? null : str(row.book_id);
    return {
      kind: spec.kind,
      id,
      title: spec.title(row) || '（无标题）',
      meta: spec.meta(row),
      snippet: makeSnippet(textFor(row, spec, query), query),
      link: buildHitLink({ kind: spec.kind, id, bookId, query }),
    };
  });
  return { kind: spec.kind, label: group.label, hits, matched };
}

export function globalSearch(query: string): GlobalSearchResult {
  const trimmed = query.trim();
  if (!trimmed) return { query: '', groups: [], total: 0, matchedTotal: 0 };
  const pattern = toLikePattern(trimmed);
  const groups = SEARCH_GROUPS.map((group) => searchOne(group, specFor(group.kind), pattern, trimmed)).filter(
    (g) => g.hits.length > 0,
  );
  return {
    query: trimmed,
    groups,
    total: groups.reduce((n, g) => n + g.hits.length, 0),
    matchedTotal: groups.reduce((n, g) => n + g.matched, 0),
  };
}

/** 每一类都要既有约定（名字与上限）又有查询；配不上就立刻报错，不静默少搜一类 */
function specFor(kind: SearchKind): KindSpec {
  const spec = SPECS.find((s) => s.kind === kind);
  if (!spec) throw new Error(`${kind} 在 SEARCH_GROUPS 里有，但没有对应的查询`);
  return spec;
}
