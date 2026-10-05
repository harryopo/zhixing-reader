/**
 * 核验区的筛选 —— 判过的那些要能翻回来
 *
 * ## 为什么需要
 *
 * 判完只有一句「你判过「对」的 N 条」，**想找回"我上个月判过哪些"只能靠记忆**。
 * 而已确认的那些正是最该被反复回看的（它们是你的判断，不是猜测），归档之后
 * 却再也找不回来 —— 累积变成了看不见的累积。
 *
 * ## 一条硬口径：筛选只管"摆哪些"，不管"算哪些"
 *
 * 顶部计数与「复制画像卡」**永远按全部条目算**。否则切一下筛选就会：
 * 在「已判对」那档复制出来的画像卡变成全部、在「还没判」那档直接不可用 ——
 * 那不是筛选，那是换一个统计口径，而界面上两者长得一模一样。
 */
import type { ProfileStatement, StatementVerdict } from '../../../../shared/profile-statements'

export type StatementFilter = 'all' | 'pending' | 'confirmed' | 'rejected'

export const STATEMENT_FILTERS: readonly StatementFilter[] = [
  'all',
  'pending',
  'confirmed',
  'rejected',
]

export const STATEMENT_FILTER_LABELS: Record<StatementFilter, string> = {
  all: '全部',
  pending: '还没判',
  confirmed: '已判对',
  rejected: '已判不对',
}

/**
 * 「还没判」这一档收 `pending` 与 `unsure` 两种 —— 用户按下「不确定」之后，
 * 那条并没有被判过，它还在等一个判断。把它归到"已判"里就等于说"这条处理完了"。
 */
function matches(statement: ProfileStatement, filter: StatementFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'pending') return statement.verdict === 'pending' || statement.verdict === 'unsure'
  return statement.verdict === (filter as StatementVerdict)
}

export function filterStatements(
  statements: readonly ProfileStatement[],
  filter: StatementFilter,
): ProfileStatement[] {
  return statements.filter((statement) => matches(statement, filter))
}

/** 每档各有几条 —— 按钮上的数字，让"已判对 12 条"这类信息不用切过去就知道 */
export function countByFilter(statements: readonly ProfileStatement[]): Record<StatementFilter, number> {
  const out = { all: statements.length, pending: 0, confirmed: 0, rejected: 0 } as Record<
    StatementFilter,
    number
  >
  for (const statement of statements) {
    if (statement.verdict === 'confirmed') out.confirmed += 1
    else if (statement.verdict === 'rejected') out.rejected += 1
    else out.pending += 1
  }
  return out
}