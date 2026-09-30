/**
 * profile-handoff — 导出包里那份说明书的文字（唯一一处口径）
 *
 * ## 为什么要程序写
 * 上一批的实际情况：外部 AI 拿不到"该交回什么形状"，就交回一篇 markdown，
 * 我得手工把它重核成 `statements.json` 才导得进。写文档的人和开闸门的人只要不是同一个人、
 * 或者不是同一份代码，文档就会漂成"照着做还是导不进去"。所以这份文字从闸门那份模块里取常量，
 * **规则改了文档跟着改**。
 *
 * ## 两条不许含糊
 * - 文档里的样例必须真能过闸（判据把那段 JSON 抠出来喂进 `parseStatementsFile` 与
 *   `validateStatements`）—— 一份跑不通的样例比没有样例更坏。
 * - 样例用的 id 是编的（`hl_1` 这种），**不含任何真实划线编号**：这份文档会随语料包
 *   交到别人手上，真实 id 是"哪一句是我划的"的可追溯线索。
 *
 * 纯函数：只吃 manifest，不碰 fs。
 */
import {
  MIN_EVIDENCE,
  STATEMENT_FILE_APP,
  STATEMENT_FILE_LABEL,
  STATEMENT_FILE_VERSION,
  STATEMENT_LAYER_LABELS,
  PROFILE_STATEMENT_LAYERS,
} from './profile-statements'
import type { StatementOrigin } from './profile-statements'
import type { ProfileManifest } from './profile-manifest'

const FENCE = '```'

/**
 * 样例清单。id 全部取自这份文档自己造出来的三个假编号，
 * 每一行都过得了闸：证据够两条、层名认得、话题与正文都不空、没写判定。
 */
function sampleFile(origin: StatementOrigin = 'nuwa'): string {
  const file = {
    app: STATEMENT_FILE_APP,
    version: STATEMENT_FILE_VERSION,
    origin,
    statements: [
      {
        id: 'p1',
        layer: 'said',
        topic: '表达',
        statement: '我写东西短、直白，习惯先给结论',
        evidenceIds: ['hl_1#note', 'hl_2#note'],
      },
      {
        id: 'p2',
        layer: 'marked',
        topic: '注意力',
        statement: '我反复留下关于注意力的句子',
        evidenceIds: ['hl_1', 'hl_2'],
      },
    ],
  }
  return `${FENCE}json\n${JSON.stringify(file, null, 2)}\n${FENCE}`
}

export function buildHandoffDoc(manifest: ProfileManifest): string {
  const layers = PROFILE_STATEMENT_LAYERS.join(' / ')
  const caveats = manifest.caveats.map((line) => `- ${line}`).join('\n')
  return `# 这批阅读证据怎么用

生成时刻：${manifest.generated_at}（UTC）
${manifest.summary}

## 一、三层证据，谁说的话别混

- \`said\`（${STATEMENT_LAYER_LABELS.said}）—— **你亲手写的字**（划线时写的想法、对话里你发出去的话、档案页填的自述）。
- \`marked\`（${STATEMENT_LAYER_LABELS.marked}）—— **作者写的句子**，你只是认为它值得留着。**这不是你的观点**，别引成你的主张。
- \`chose\`（${STATEMENT_LAYER_LABELS.chose}）—— 你书架上的书与每日阅读记录。分类标签出自微信读书的平台体系，不是你选的词。

回指某一条证据时用它的 \`id\`：想法那条带 \`#note\` 后缀（同一条划线会出两条记录、id 不同）。

## 二、这批证据缺什么（先读这一节再下结论）

${caveats}

## 三、你要交回的东西：一份 ${STATEMENT_FILE_LABEL}（文件名建议用 \`statements.json\`）

不要交回 markdown 段落 —— 应用读不进去，只能人工重抄一遍。请交回**这一个文件**，形状如下：

${sampleFile()}

规则（应用会把不合的逐条挡下并告诉你原因，不会整批崩）：

- 一条结论的证据至少 ${MIN_EVIDENCE} 条（填在 \`evidenceIds\` 里），孤证不立。
- 每个 id 必须**真在这批语料里**。对不上号的 id 会被挡 —— 那样界面上那颗「回原文」就是死链。
- \`layer\` 只认 ${layers}。
- \`topic\`（话题）与 \`statement\`（结论正文）都要写，正文写成一句关于这个人的话，别写成书名摘要。
- \`id\` 在同一份文件里不能重复。
- **不要写判定**（\`verdict\`）：那一格只有本人在应用界面上按下才算，文件里写了也不生效。
- \`app\` 填 \`${STATEMENT_FILE_APP}\`、\`version\` 填 \`${STATEMENT_FILE_VERSION}\`、\`origin\` 填 \`nuwa\`（外部蒸馏）或 \`manual\`（你手工整理）。

## 四、交回之后会发生什么

1. 在应用「档案 → 画像核验」里导入这份文件，过闸的每条落在库里，状态都是「还没判」。
2. 你逐条点「对 / 不对 / 不确定」。**只有点过「对」的**才会拼进那张短画像卡（约 150 token），
   卡装不下了会自己写「还有 N 条没放进去」。
3. 再导一次同名文件不会推翻你已经按过的判定 —— 画像是沉淀，不是一次性导出。

## 五、不要做的事

- 不给人格类型 / 大五 / 职业倾向这类判定：中文短句判心理含义的可信度很低，而这里的想法平均不到二十字一条。
- 不写「读小说让人更共情」这类已被复现失败的话。
- 不做联网交叉验证：这批证据只在这台电脑上，你读到的就是全部。表达风格那一维只看 \`said\` 层，
  那层为空时请在结论里明说「这一维不适用」，不要拿作者句子冒充本人的风格。
`
}
