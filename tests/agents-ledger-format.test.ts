/**
 * AGENTS §十 台账表的**格式**守卫（2026-10-17）
 *
 * 起因不是"想要多一道门"，是同一晚连撞三次同一个坑：
 *   ① 单元格里写了个没转义的竖线（`` `gh run watch --exit-status | tail` ``），
 *      Markdown 当场把那一格劈成两列，整行错位 —— 而且**没人看得出**，因为它只是一格变两格；
 *   ② 我把"更正某一行"的那行插到了被更正行的**上面**，句子里却写「上一行是错的」——
 *      按表格顺序那指的是另一行，读者要顺着找错对象；
 *   ③ 我用 `awk` 按竖线数格子，它把转义后的 `\|` 也算分隔符，于是"修好了"照样报异常。
 *      —— 数格子的式子必须先把转义竖线让位，这条判据就是这么写的。
 *
 * **只管格式，不碰事实**：`tests/doc-figures.test.ts` 那套数字对账按既有规矩排除 §十
 * （历史行里的数字是当年实测，拿今天的真值去改它等于伪造历史）。
 * 而"几格、什么顺序"不是事实陈述，是排版 —— 挡住它不影响任何历史记录的内容。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const HEADER = '| 日期 | 变更 | 摘要 |'

function ledgerLines(): string[] {
  const text = readFileSync('AGENTS.md', 'utf8')
  return text.split(/\r?\n/).filter((l) => /^\| 2026-/.test(l))
}

/** 单元格数：先把转义竖线让位再切分（见 ③），再去掉首尾两个空段 */
function cells(line: string): number {
  return line.replace(/\\\|/g, ' ').split('|').length - 2
}

/** 日期格里第一个 YYYY-MM-DD（格子里可能带着"接上一批"之类的补充文字） */
function dateOf(line: string): string {
  const cell = line.replace(/\\\|/g, ' ').split('|')[1] ?? ''
  return cell.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ''
}

/** 哪里不是往后追加的：返回每一处"前一行日期晚于后一行" */
function outOfOrder(rows: string[]): string[] {
  const out: string[] = []
  for (let i = 1; i < rows.length; i++) {
    if (dateOf(rows[i - 1]) > dateOf(rows[i])) {
      out.push(`${dateOf(rows[i - 1])} 排在了 ${dateOf(rows[i])} 前面`)
    }
  }
  return out
}

describe('AGENTS §十 台账表的排版', () => {
  it('判据自己看得见东西：表头在、行数够（读空了下面几条全是空话）', () => {
    const text = readFileSync('AGENTS.md', 'utf8')
    expect(text.split(/\r?\n/).some((l) => l.startsWith(HEADER)), '找不到台账表头行').toBe(true)
    // 2026-10-17 本轮实测 10 行；掉到 8 以下说明扫描口径变了（比如表头改了写法）
    expect(ledgerLines().length, '台账行数少于 8 行，先怀疑这里的匹配式').toBeGreaterThanOrEqual(8)
  })

  it('每一行的格子数都等于表头 —— 一格里的裸竖线会被当场抓出来', () => {
    const base = cells(readFileSync('AGENTS.md', 'utf8').split(/\r?\n/).find((l) => l.startsWith(HEADER)) ?? '')
    expect(base, '表头本身必须是 3 格').toBe(3)
    const bad = ledgerLines().filter((l) => cells(l) !== base)
    expect(
      bad.map((l) => `${dateOf(l)} → ${cells(l)} 格：${l.slice(0, 40)}`),
      '这些台账行的格子数与表头不符（十有八九是单元格里写了没转义的竖线，用 \\| 转义掉）',
    ).toEqual([])
  })

  it('日期不回退 —— 更正行必须排在被更正的那行之后', () => {
    // 位置写反的后果不是难看，是句子里的"上一行 / 上面那行"指向另一件事
    expect(outOfOrder(ledgerLines()), '台账不是按日期往后追加').toEqual([])
  })

  it('反证 · 一根没转义的竖线确实会让格子数变化（不然上面那条是空的）', () => {
    const row = ledgerLines()[0]
    // 真在内容里多一根裸竖线 = 多一个分隔符。这就是 ① 那个坑的最小形状。
    expect(cells(row + ' |'), '加一根裸竖线后格子数没变 ⇒ 数格子的式子瞎了').toBe(cells(row) + 1)
    // 转义过的不算（③ 那个 awk 就是把 `\|` 也当分隔符才误报的）
    expect(cells(row + ' \\|'), '转义竖线不该被当成分隔符').toBe(cells(row))
  })

  it('反证 · 日期回退的形状必须被查得出来（不依赖仓库里今天有哪几天）', () => {
    expect(outOfOrder(['| 2026-01-02 | a | b |', '| 2026-01-01 | a | b |']))
      .toEqual(['2026-01-02 排在了 2026-01-01 前面'])
    // 同一天追加多行是允许的（一批里连提两笔很常见）
    expect(outOfOrder(['| 2026-01-02 | a | b |', '| 2026-01-02 | c | d |'])).toEqual([])
    expect(outOfOrder(['| 2026-01-01 | a | b |', '| 2026-01-02 | c | d |'])).toEqual([])
  })
})
