/**
 * 全局搜索（主进程一次查完五类）
 *
 * 为什么不在渲染层拼五次：五类各发一条 IPC 会让结果页等五个来回，而且"哪些类算搜过、
 * 每类几条"这件事会在界面与数据库两侧各记一份 —— 本项目被这类双口径咬过不止一次。
 * 类名、每类上限、片段截法、链接拼法都在 `src/shared/global-search.ts` 那一份里。
 *
 * WHERE 由 `likeColumns` × 关键词现拼：词与词之间是 AND，每个词命中任一列即算命中 ——
 * 与笔记页那台筛选器同一套语义（那边是把四个字段拼成一个字符串再逐词 includes）。
 * 行查询与 COUNT 共用同一次拼出的 where 与同一批 params，所以"报的数"与"给的行"
 * 不可能不是同一批；两处 SQL 的 `?` 个数与 params 长度每次核对。
 *
 * 值一律走 `?` 占位符，`%` 与 `_` 已在 pattern 里转义，配套的 `ESCAPE '\'` 不能少。
 */
import { getDatabase } from '../database/connection';
import { rowsToObjects } from '../utils/db';
import {
  SEARCH_GROUPS,
  buildHitLink,
  makeSnippet,
  splitQueryTerms,
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
  /** 参与关键词匹配的列：加一列就等于同时扩大行查询与 COUNT，不会两边不一致 */
  likeColumns: string[];
  /** 列出哪几条：按时间倒序最贴近"我最近划的那句" */
  order: string;
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
    // 少一列，「共 916 条」点过去就会变成另一个数
    likeColumns: ['h.content', 'h.note', 'h.chapter_title', 'b.title'],
    order: 'h.created_at DESC',
    textColumns: ['content', 'note', 'chapter_title', 'book_title'],
    title: (r) => str(r.book_title),
    meta: (r) => str(r.chapter_title),
  },
  {
    kind: 'card',
    columns: `k.id, k.book_id, k.title, k.content, k.interpretation, k.type, b.title AS book_title`,
    from: `FROM knowledge_cards k JOIN books b ON k.book_id = b.id`,
    likeColumns: ['k.title', 'k.content', 'k.interpretation'],
    order: 'k.created_at DESC',
    textColumns: ['content', 'interpretation', 'title'],
    title: (r) => str(r.title),
    meta: (r) => str(r.book_title),
  },
  {
    kind: 'methodology',
    columns: `m.id, m.book_id, m.name, m.description, m.steps, m.trigger_scenario, b.title AS book_title`,
    from: `FROM methodologies m JOIN books b ON m.book_id = b.id`,
    likeColumns: ['m.name', 'm.description', 'm.steps'],
    order: 'm.created_at DESC',
    textColumns: ['description', 'steps', 'trigger_scenario', 'name'],
    title: (r) => str(r.name),
    meta: (r) => str(r.book_title),
  },
  {
    kind: 'article',
    columns: `id, title_zh, title_en, summary_zh, content_zh, content_en, difficulty, category`,
    from: 'FROM articles',
    likeColumns: ['title_zh', 'title_en', 'summary_zh', 'content_zh'],
    order: 'created_at DESC',
    textColumns: ['summary_zh', 'content_zh', 'title_zh', 'content_en', 'title_en'],
    title: (r) => str(r.title_zh) || str(r.title_en),
    meta: (r) => [str(r.difficulty), str(r.category)].filter(Boolean).join(' · '),
  },
  {
    kind: 'word',
    columns: `id, word, meaning_zh, example_zh, phonetic, cefr_level, part_of_speech`,
    from: 'FROM vocabulary',
    likeColumns: ['word', 'meaning_zh'],
    order: 'created_at DESC',
    textColumns: ['meaning_zh', 'example_zh', 'word'],
    title: (r) => str(r.word),
    meta: (r) =>
      [str(r.part_of_speech), str(r.cefr_level) && `CEFR ${str(r.cefr_level)}`]
        .filter(Boolean)
        .join(' · '),
  },
];

interface BuiltWhere {
  sql: string;
  /** 一个词 × 一列一个值，所以只能是 string；LIMIT 那个数字由调用方另加 */
  params: string[];
}

/** 词与词 AND、列与列 OR；params 顺序与 SQL 里的 `?` 一一对应 */
function buildWhere(spec: KindSpec, terms: string[]): BuiltWhere {
  const perTerm = spec.likeColumns.map((c) => `${c} ${LIKE}`).join(' OR ');
  return {
    sql: terms.map(() => `(${perTerm})`).join(' AND '),
    params: terms.flatMap((t) => spec.likeColumns.map(() => toLikePattern(t))),
  };
}

/**
 * SQL 里的 `?` 个数必须等于 params 长度。
 *
 * 多一个少一个都会静默错位（sqlite 只会抱怨绑定数不对，而"哪一列没参与匹配"看不出来），
 * 拼法改了这一条仍然兜得住。
 */
function assertPlaceholderCount(sql: string, params: Array<string | number>, kind: SearchKind): void {
  const marks = (sql.match(/\?/g) ?? []).length;
  if (marks !== params.length) {
    throw new Error(`${kind} 的查询有 ${marks} 个 ?，但传了 ${params.length} 个值`);
  }
}

/** 从若干列里挑第一个真含任一关键词的作为片段来源 */
function textFor(row: Row, spec: KindSpec, terms: string[]): string {
  for (const col of spec.textColumns) {
    const v = str(row[col]).toLowerCase();
    if (terms.some((t) => v.includes(t.toLowerCase()))) return str(row[col]);
  }
  return str(row[spec.textColumns[0]]);
}

/** 每一类都要既有约定（名字与上限）又有查询；配不上就立刻报错，不静默少搜一类 */
function specFor(kind: SearchKind): KindSpec {
  const spec = SPECS.find((s) => s.kind === kind);
  if (!spec) throw new Error(`${kind} 在 SEARCH_GROUPS 里有，但没有对应的查询`);
  return spec;
}

function searchOne(
  group: SearchGroupSpec,
  spec: KindSpec,
  where: BuiltWhere,
  terms: string[],
): SearchGroupResult {
  const db = getDatabase();
  const selectSql = `SELECT ${spec.columns} ${spec.from} WHERE ${where.sql} ORDER BY ${spec.order} LIMIT ?`;
  const countSql = `SELECT COUNT(*) ${spec.from} WHERE ${where.sql}`;
  assertPlaceholderCount(selectSql, [...where.params, group.limit], spec.kind);
  assertPlaceholderCount(countSql, where.params, spec.kind);
  // 先数总数再取前几条：两条 SQL 共用同一份 where 与 params，报的数与给的行必然同批
  const counted = db.exec(countSql, where.params);
  const matched = counted.length > 0 ? Number(counted[0].values[0][0]) : 0;
  const rows = rowsToObjects(db.exec(selectSql, [...where.params, group.limit]));
  const hits: SearchHit[] = rows.map((row) => {
    const id = str(row.id);
    const bookId = row.book_id === undefined || row.book_id === null ? null : str(row.book_id);
    return {
      kind: spec.kind,
      id,
      title: spec.title(row) || '（无标题）',
      meta: spec.meta(row),
      snippet: makeSnippet(textFor(row, spec, terms), terms[0]),
      link: buildHitLink({ kind: spec.kind, id, bookId, query: terms.join(' ') }),
    };
  });
  return { kind: spec.kind, label: group.label, hits, matched };
}

export function globalSearch(query: string): GlobalSearchResult {
  const terms = splitQueryTerms(query);
  const trimmed = query.trim();
  if (terms.length === 0) return { query: '', groups: [], total: 0, matchedTotal: 0 };
  const groups = SEARCH_GROUPS.map((group) => {
    const spec = specFor(group.kind);
    return searchOne(group, spec, buildWhere(spec, terms), terms);
  }).filter((g) => g.hits.length > 0);
  return {
    query: trimmed,
    groups,
    total: groups.reduce((n, g) => n + g.hits.length, 0),
    matchedTotal: groups.reduce((n, g) => n + g.matched, 0),
  };
}
