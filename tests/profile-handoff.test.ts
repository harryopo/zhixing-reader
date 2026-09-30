/**
 * profile-handoff —— 导出包里那份「给外部 AI 看的说明书」由程序生成
 *
 * 上一批的教训：外部 AI 拿不到形状说明就交回 markdown，人工再抄一遍。
 * 所以这份文档现在跟着语料包一起写出去，而它写的规则**必须与导入那道闸同源** ——
 * 否则文档说「两条证据」而闸门要三条，用户照文档做完还是导不进去。
 */
import { describe, it, expect } from 'vitest'
import { buildHandoffDoc } from '../src/shared/profile-handoff'
import {
  MIN_EVIDENCE,
  STATEMENT_FILE_APP,
  STATEMENT_FILE_VERSION,
  STATEMENT_FILE_LABEL,
  STATEMENT_LAYER_LABELS,
  parseStatementsFile,
  validateStatements,
} from '../src/shared/profile-statements'
import type { ProfileManifest } from '../src/shared/profile-manifest'
import { SKILL_DESCRIPTION, SKILL_DIR_NAME, buildSkillFile } from '../src/shared/profile-skill'
import { BODY_MAX_LINES, checkSkill } from './__fixtures__/skill-spec'

const manifest: ProfileManifest = {
  generated_at: '2026-09-30T01:00:00.000Z',
  summary: '我说的 2 条（30 字） · 我挑的 3 条（60 字） · 我选的 1 条',
  layers: {
    said: { records: 2, chars: 30 },
    marked: { records: 3, chars: 60 },
    chose: { records: 1, chars: 20 },
  },
  total_records: 6,
  total_chars: 110,
  dropped: { insight: 1 },
  volumes: [{ file: 'said-vol-01.jsonl', layer: 'said', records: 2, chars: 30 }],
  caveats: ['语料只来自这台电脑上的本地库'],
}

const doc = buildHandoffDoc(manifest)

describe('文档内容与闸门同源', () => {
  /**
   * 门槛从**闸门的行为**推出来，不是从常量名读出来：
   * 逐条喂 1 / 2 / 3 条证据，第一条被收下的那个数就是门槛。
   * 文档里写的数必须与这个行为一致 —— 若判据只比 `MIN_EVIDENCE` 那个常量，
   * 它就成了同义反复（文档与常量同源，但两边一起错时判据仍绿）。
   */
  const threshold = (() => {
    for (const count of [1, 2, 3, 4]) {
      const ids = Array.from({ length: count }, (_, i) => `hl_${i}`)
      const { accepted } = validateStatements(
        [{ id: 'x', layer: 'said', topic: 't', statement: 's', evidenceIds: ids }],
        new Set(ids),
      )
      if (accepted.length === 1) return count
    }
    throw new Error('闸门的行为读不出门槛：4 条都不收')
  })()

  it('写明至少几条证据 —— 那个数必须等于闸门实际收下的门槛', () => {
    expect(threshold).toBe(MIN_EVIDENCE)
    expect(doc).toContain(`至少 ${threshold} 条`)
  })

  it('写明文件要带的 app 与 version —— 与闸门认的那两个值一字不差', () => {
    expect(doc).toContain(STATEMENT_FILE_APP)
    expect(doc).toContain(STATEMENT_FILE_VERSION)
  })

  it('写明判定那一格不要填（填了也不生效，只有本人在界面上按）', () => {
    expect(doc).toContain('不要写判定')
    expect(doc).toContain('按')
  })

  it('每个层名都出现，且带一句"这是谁说的话"', () => {
    for (const layer of ['said', 'marked', 'chose']) expect(doc).toContain(layer)
    expect(doc).toContain('作者写的')
  })

  it('每个层名用的是界面上那套标签（同一个词在两处各写一遍，迟早一个改了一个没改）', () => {
    for (const label of Object.values(STATEMENT_LAYER_LABELS)) {
      if (label === STATEMENT_LAYER_LABELS.inferred) continue
      expect(doc, `文档里少了界面用的层标签：${label}`).toContain(label)
    }
    expect(doc).not.toContain(STATEMENT_LAYER_LABELS.inferred)
  })

  it('告诉对方这份清单叫什么名字 —— 与导入弹框那个筛选器同名', () => {
    expect(doc).toContain(STATEMENT_FILE_LABEL)
  })

  it('报告这批证据有多少条、缺什么 —— 说明书不许比 manifest 少说话', () => {
    expect(doc).toContain(manifest.summary)
    for (const caveat of manifest.caveats) expect(doc).toContain(caveat)
  })
})

describe('文档里那份样例是跑得通的', () => {
  it('把样例抠出来喂给导入那道闸：认得出文件、每条都过闸', () => {
    const sample = doc.slice(doc.indexOf('```json'), doc.indexOf('```', doc.indexOf('```json') + 7) + 3)
      .replace(/^```json\n/, '')
      .replace(/\n```$/, '')
    const parsed = parseStatementsFile(sample)
    if (!parsed.ok) throw new Error(`样例没过文件级校验：${parsed.reason}`)
    // 假语料：样例里引到的那四个编号都在。判的是"样例照做能过闸"，不是"样例自己造自己的真值"
    const ids = new Set(['hl_1', 'hl_2', 'hl_1#note', 'hl_2#note'])
    const { accepted, rejected } = validateStatements(parsed.file.statements, ids)
    expect(rejected).toEqual([])
    expect(accepted.length).toBeGreaterThan(0)
  })

  it('样例用的 id 是编的（hl_1 这种），不含任何真实划线编号', () => {
    expect(doc).toContain('hl_1')
    expect(doc).not.toMatch(/hl_\d{13}_[a-z0-9]{6,}/)
  })
})

describe('文档能撑起一个合规的 Skill 目录', () => {
  it('套上 frontmatter 之后过规范检查：正文行数、name 与目录名同源', () => {
    const text = buildSkillFile({ name: SKILL_DIR_NAME, description: SKILL_DESCRIPTION, body: doc })
    expect(checkSkill(text, SKILL_DIR_NAME)).toEqual([])
  })

  it('反证：目录名写歪一寸，客户端就是不加载 —— 检查器必须报出来', () => {
    const text = buildSkillFile({ name: 'zhixing-profile', description: SKILL_DESCRIPTION, body: doc })
    expect(checkSkill(text, SKILL_DIR_NAME)).toContain('name（zhixing-profile）与目录名（zhixing-reader-profile）不等')
  })

  it('说明书本身不超过规范给正文的行数上限（写长了客户端就不加载，而它不会报错）', () => {
    expect(doc.split('\n').length).toBeLessThan(BODY_MAX_LINES)
  })
})
