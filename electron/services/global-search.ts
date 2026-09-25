/**
 * 全局搜索（主进程一次查完五类）
 *
 * 为什么在主进程拼：五类各发一条 IPC 会让结果页等五个来回，而且"每类上限"这件事
 * 会在界面与数据库两侧各记一份 —— 本项目被这类双口径咬过不止一次。类名、上限、
 * 片段截法、链接拼法都在 `src/shared/global-search.ts` 那一份里。
 *
 * 值一律走 `?` 占位符；`%` 与 `_` 在 pattern 里已被转义，所以配套的 `ESCAPE '\'`
 * 一个字都不能少（少了转义就不生效，搜 `100%` 会命中所有行）。
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
  sql: string;
  /** pattern 用几次 —— 必须与 sql 里 LIKE 的个数一致，由测试逐条钉住 */
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
    sql: `SELECT h.id, h.book_id, h.content, h.note, h.chapter_title, b.title AS book_title
          FROM highlights h JOIN books b ON h.book_id = b.id
          WHERE h.content ${LIKE} OR h.note ${LIKE}
          ORDER BY h.created_at DESC LIMIT ?`,
    patternCount: 2,
    textColumns: ['content', 'note'],
    title: (r) => str(r.book_title),
    meta: (r) => str(r.chapter_title),
  },
  {
    kind: 'card',
    sql: `SELECT k.id, k.book_id, k.title, k.content, k.interpretation, k.type, b.title AS book_title
          FROM knowledge_cards k JOIN books b ON k.book_id = b.id
          WHERE k.title ${LIKE} OR k.content ${LIKE} OR k.interpretation ${LIKE}
          ORDER BY k.created_at DESC LIMIT ?`,
    patternCount: 3,
    textColumns: ['content', 'interpretation', 'title'],
    title: (r) => str(r.title),
    meta: (r) => str(r.book_title),
  },
  {
    kind: 'methodology',
    sql: `SELECT m.id, m.book_id, m.name, m.description, m.steps, m.trigger_scenario, b.title AS book_title
          FROM methodologies m JOIN books b ON m.book_id = b.id
          WHERE m.name ${LIKE} OR m.description ${LIKE} OR m.steps ${LIKE}
          ORDER BY m.created_at DESC LIMIT ?`,
    patternCount: 3,
    textColumns: ['description', 'steps', 'trigger_scenario', 'name'],
    title: (r) => str(r.name),
    meta: (r) => str(r.book_title),
  },
  {
    kind: 'article',
    sql: `SELECT id, title_zh, title_en, summary_zh, content_zh, content_en, difficulty, category
          FROM articles
          WHERE title_zh ${LIKE} OR title_en ${LIKE} OR summary_zh ${LIKE} OR content_zh ${LIKE}
          ORDER BY created_at DESC LIMIT ?`,
    patternCount: 4,
    textColumns: ['summary_zh', 'content_zh', 'title_zh', 'content_en', 'title_en'],
    title: (r) => str(r.title_zh) || str(r.title_en),
    meta: (r) => [str(r.difficulty), str(r.category)].filter(Boolean).join(' · '),
  },
  {
    kind: 'word',
    sql: `SELECT id, word, meaning_zh, example_zh, phonetic, cefr_level, part_of_speech
          FROM vocabulary
          WHERE word ${LIKE} OR meaning_zh ${LIKE}
          ORDER BY created_at DESC LIMIT ?`,
    patternCount: 2,
    textColumns: ['meaning_zh', 'example_zh', 'word'],
    title: (r) => str(r.word),
    meta: (r) =>
      [str(r.part_of_speech), str(r.cefr_level) && `CEFR ${str(r.cefr_level)}`].filter(Boolean).join(' · '),
  },
];

/** sql 里 LIKE 的个数 == patternCount（多一个少一个都是把某一列漏搜了） */
function assertLikeCount(spec: KindSpec, sql: string): void {
  const likes = (sql.match(new RegExp(LIKE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length;
  if (likes !== spec.patternCount) {
    throw new Error(`${spec.kind} 的查询有 ${likes} 处 LIKE，与 patternCount=${spec.patternCount} 不符`);
  }
}

function textFor(row: Row, spec: KindSpec, query: string): string {
  const needle = query.toLowerCase();
  for (const col of spec.textColumns) {
    const v = str(row[col]);
    if (v.toLowerCase().includes(needle)) return v;
  }
  return str(row[spec.textColumns[0]]);
}

/** 每一类都要既有约定（名字与上限）又有查询；配不上就立刻报错，不静默少搜一类 */
function specFor(kind: SearchKind): KindSpec {
  const spec = SPECS.find((s) => s.kind === kind);
  if (!spec) throw new Error(`${kind} 在 SEARCH_GROUPS 里有，但没有对应的查询`);
  return spec;
}

function searchOne(group: SearchGroupSpec, spec: KindSpec, pattern: string, query: string): SearchGroupResult {
  assertLikeCount(spec, spec.sql);
  const rows = rowsToObjects(
    getDatabase().exec(spec.sql, [...Array<string>(spec.patternCount).fill(pattern), group.limit]),
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
  return { kind: spec.kind, label: group.label, hits };
}

export function globalSearch(query: string): GlobalSearchResult {
  const trimmed = query.trim();
  if (!trimmed) return { query: '', groups: [], total: 0 };
  const pattern = toLikePattern(trimmed);
  const groups = SEARCH_GROUPS.map((group) =>
    searchOne(group, specFor(group.kind), pattern, trimmed),
  ).filter((g) => g.hits.length > 0);
  return { query: trimmed, groups, total: groups.reduce((n, g) => n + g.hits.length, 0) };
}
