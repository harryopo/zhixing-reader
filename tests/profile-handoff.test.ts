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
  INFERRED_LAYER_NOTE,
  INFERRED_REJECT_TEXT,
  PROFILE_STATEMENT_LAYERS,
  PROFILE_STATEMENT_ALL_LAYERS,
  STATEMENT_FILE_APP,
  STATEMENT_FILE_VERSION,
  STATEMENT_FILE_LABEL,
  STATEMENT_LAYER_LABELS,
  parseStatementsFile,
  validateStatements,
  describeStatementImport,
} from '../src/shared/profile-statements'
import type { ProfileManifest } from '../src/shared/profile-manifest'
import { buildVerified, VERIFIED_FILE_NAME } from '../src/shared/profile-verified'
import { CORPUS_MAX_CHARS_PER_VOLUME, planVolumes, volumeChars } from '../src/shared/profile-corpus'
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

// 两份 doc 都从真函数现造，不手写字面量：
// `docEmpty` 是还没有任何判定的第一批，`docSome` 是判过几条之后的那批。
// 说明书里「已确认」那一节的两种说法都要被测到 —— 只测一种就会漏掉另一种被改坏。
const AT = new Date('2026-09-30T01:00:00.000Z')

const docEmpty = buildHandoffDoc(manifest, buildVerified([], AT))

const doc = buildHandoffDoc(
  manifest,
  buildVerified(
    [
      {
        id: 'p1',
        layer: 'said',
        topic: '你怎么用时间',
        statement: '晚上比早晨更愿意坐下来读长文',
        evidenceIds: ['hl_1', 'hl_1#note'],
        verdict: 'confirmed',
      },
      { id: 'p2', layer: 'marked', topic: 't', statement: 's', evidenceIds: ['h1'], verdict: 'pending' },
    ],
    AT,
  ),
)

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

  it('三个可用层用的是界面上那套标签（同一个词在两处各写一遍，迟早一个改了一个没改）', () => {
    for (const layer of PROFILE_STATEMENT_LAYERS) {
      expect(doc, `文档里少了可用的层：${layer}`).toContain(layer)
      expect(doc, `文档里少了界面上那套标签：${STATEMENT_LAYER_LABELS[layer]}`).toContain(
        STATEMENT_LAYER_LABELS[layer],
      )
    }
  })

  // 这条 2026-09-30 改过：原来断的是「文档里不许出现 inferred 这四个字」，
  // 那是在防「把没有生产者的第四层当可用选项列进层清单」。但它连"为什么不能用"一起
  // 抹掉了 ⇒ 外部 AI 读到「层只有三种」，若仍写 inferred 就会被自己的应用挡下，
  // 而文档从没说过有这么一层。**闸门挡它是对的，说明书不提它也是对的，
  // 只说"不收"不说"有这么一层"是错的** —— 用户照文档做的文件被挡，只会以为文件坏了。
  it('第四层 inferred：写明它不收，且不许被列成可用选项', () => {
    // 说清了"有这一层、现在不收、写了会被挡"
    expect(doc).toContain(STATEMENT_LAYER_LABELS.inferred)
    expect(doc).toContain('不收')
    // 但可用层清单里不许有它 —— 这条是原判据真正要守的东西。
    // ⚠️ 只断言 inferred 缺席是不够的：清单整行删掉时它也"不出现"，那是空转。
    const rule = doc.split('\n').find((l) => l.includes('`layer` 只认'))!
    expect(rule, '找不到「layer 只认」那条规则行').toBeTruthy()
    for (const layer of PROFILE_STATEMENT_LAYERS) {
      expect(rule, `可用层清单里少了 ${layer}`).toContain(layer)
    }
    expect(rule, `可用层清单里不该出现 ${PROFILE_STATEMENT_ALL_LAYERS[3]}`).not.toContain(
      PROFILE_STATEMENT_ALL_LAYERS[3],
    )
  })

  it('闸门说的那句人话与说明书同源（对方看到的话与界面告诉用户的话不许各写一遍）', () => {
    expect(doc).toContain(INFERRED_REJECT_TEXT)
    expect(INFERRED_LAYER_NOTE).toContain(INFERRED_REJECT_TEXT)
    // 那句话必须真的来自闸门，不是判据自己写了一遍就算数
    const v = validateStatements(
      [{ id: 'p1', layer: 'inferred', topic: 't', statement: 's', evidenceIds: ['h1', 'h2'] }],
      new Set(['h1', 'h2']),
    )
    expect(v.rejected.map((r) => r.reason)).toEqual(['inferred_disabled'])
    expect(
      describeStatementImport({ toWrite: [], protectedIds: [], rejected: v.rejected }),
    ).toContain(INFERRED_REJECT_TEXT)
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

describe('说明书把"能撑到哪、撑不到哪"写死', () => {
  /** 「诚实边界」那一节里的条目：按节切，数它自己的项目符号，不数常量数组长度 */
  const boundaryItems = (): string[] => {
    const section = doc.split('\n## ').find((block) => block.startsWith('六、诚实边界'))
    if (!section) throw new Error(`文档里没有「六、诚实边界」这一节\n${doc}`)
    return section.split('\n').filter((line) => line.startsWith('- '))
  }

  it('有「诚实边界」一节，且条目不少于 3 条（方案书 §8 那条静态阈值）', () => {
    expect(boundaryItems().length).toBeGreaterThanOrEqual(3)
  })

  it('写死这一条：本地模式没有「他者视角」与「时间线」两维，这两块必然薄弱', () => {
    const found = boundaryItems().find((line) => line.includes('他者视角') && line.includes('时间线'))
    expect(found, '缺了那两维的交代，外部工具会蒙过去').toBeDefined()
    expect(found).toContain('薄弱')
  })

  it('写明每卷上限多少字 —— 那个数要等于分卷实际装下的字数', () => {
    // 行为推出来的上限：每条 1000 字，按同一个 maxChars 分卷 ⇒ 一卷装下的就是那个数。
    // 文档里写死一个别的数（比如 5000）就当场对不上。
    const rows = Array.from({ length: 9 }, (_, i) => ({
      id: `r${i}`,
      layer: 'marked' as const,
      kind: 'highlight' as const,
      text: '一'.repeat(1000),
      at: null,
    }))
    const packed = Math.max(...planVolumes(rows, CORPUS_MAX_CHARS_PER_VOLUME).map((v) => volumeChars(v.records)))
    expect(doc).toContain(`${packed} 字`)
  })

  it('交代清楚交给外部蒸馏工具的做法：选纯本地语料、把 corpus 那些卷一起给它、不联网交叉验证', () => {
    expect(doc).toContain('纯本地语料')
    expect(doc).toContain('corpus/')
    expect(doc).toContain('不联网')
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

// 2026-09-30 补：「已确认」那一节的**两种说法**都要被测。
// 只测"判过几条"那份，空批那句就没人看 —— 而空批恰恰是第一次导出时用户看到的那一份，
// 它说错的话，第一次用的人就被误导（对方会以为"没有已确认"是文件坏了而不是真的没判过）。
describe('已确认清单那一节：两种状态各说各的', () => {
  it('判过几条：说清"这是你按下过的"、"不要重复提"、"别改它的正文"', () => {
    expect(doc).toContain(VERIFIED_FILE_NAME)
    expect(doc).toContain('按下过')
    expect(doc).toContain('不要重复提')
    expect(doc).toContain('别改它的正文')
    // id 复用是整个设计的要点：对方拿同一个 id 交回，闸门才认得出"这条已确认过"
    expect(doc).toContain('同一个')
  })

  it('一条都没判过：明确说"这批是空的"、说清这是第一批，不许说成"没有已确认文件"', () => {
    expect(docEmpty).toContain('这一批是空的')
    expect(docEmpty).toContain('0')
    expect(docEmpty).toContain('第一轮')
    // 空批不许出现那三句劝告 —— 没有已确认时提"不要重复提"是把对方当傻子
    expect(docEmpty).not.toContain('不要重复提')
  })

  it('反证 · 空批那句改成非空批的说法，两份判据都要判红', () => {
    const wrong = buildHandoffDoc(manifest, buildVerified([{
      id: 'x', layer: 'said', topic: 't', statement: 's',
      evidenceIds: ['a', 'b'], verdict: 'confirmed',
    }], AT))
    expect(wrong, '拿非空的那份冒充空的，这条判据就没牙').not.toContain('这一批是空的')
  })
})
