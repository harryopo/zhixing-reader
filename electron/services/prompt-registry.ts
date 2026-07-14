import { logger } from '../logger'

export type PromptCategory = 'agent' | 'intent' | 'ai'

export interface PromptVariable {
  name: string
  description: string
  sample: string
}

export interface PromptMeta {
  id: string
  category: PromptCategory
  feature: string
  role: 'system' | 'user'
  title: string
  description: string
  defaultTemplate: string
  variables: PromptVariable[]
  exampleVars: Record<string, string>
}

export const PROMPT_REGISTRY: PromptMeta[] = [
  {
    id: 'agent.system',
    category: 'agent',
    feature: 'agent',
    role: 'system',
    title: '智能体人设',
    description: '智能阅读助手的核心人设，决定整体回复风格、引用策略、Markdown 规范。',
    defaultTemplate: `你是智能阅读助手，基于用户阅读笔记教学。

回答要求：
1. 笔记中没有的信息坦诚告知，引用笔记原文支持你的观点
2. 使用Markdown格式，善用标题、列表、引用保持层级清晰
3. 按需求自适应教学：知识查询→简洁回答，深度讨论→苏格拉底式追问，教学请求→费曼学习法让用户自己解释，评测→出理解题`,
    variables: [],
    exampleVars: {},
  },
  {
    id: 'agent.intentKeywords',
    category: 'intent',
    feature: 'agent',
    role: 'system',
    title: '意图识别关键词',
    description: '用于识别用户消息意图的关键词集合（每个意图一行多个关键词，用逗号分隔）。修改后下次对话生效。',
    defaultTemplate: `knowledge_query: 什么是,是什么,解释,意思,定义,告诉我,介绍,简单说,通俗,入门,基础,概念,原理,为什么,怎么回事,如何理解,指的是,区别于,有什么用
deep_discussion: 深入,深度,详细,核心,论点,比较,对比,区别,联系,关联,具体说,展开,思考问题,思考,分析,评价,批判,优缺点,利弊,更深,本质,根本原因,背后的,内在逻辑,为什么说
teaching_practice: 教我,费曼,讲解,给我讲,帮我学,考考我,测试,评估,提问我,怎么用,如何应用,实践,怎么做,复习,回顾,帮我复习,出题,练习,举例说明,用例子,演示,模拟,场景
casual_chat: 你好,嗨,谢谢,再见,哈哈,早上好,晚上好,辛苦了,好的,明白了`,
    variables: [],
    exampleVars: {},
  },
  {
    id: 'agent.difficultyHint.increase',
    category: 'agent',
    feature: 'agent',
    role: 'system',
    title: '难度提示 - 提升 Bloom 层级',
    description: '当用户近期表现良好时，附加到 prompt 的提示。',
    defaultTemplate: '\n用户近期表现良好，请适当提升问题深度，引导更高层次的思考和综合应用。',
    variables: [],
    exampleVars: {},
  },
  {
    id: 'agent.difficultyHint.decrease',
    category: 'agent',
    feature: 'agent',
    role: 'system',
    title: '难度提示 - 降低 Bloom 层级',
    description: '当用户遇到困难时附加的提示。',
    defaultTemplate: '\n用户近期遇到困难，请降低难度，用更简单的方式解释，多给示例帮助理解。',
    variables: [],
    exampleVars: {},
  },
  {
    id: 'agent.difficultyHint.mastered',
    category: 'agent',
    feature: 'agent',
    role: 'system',
    title: '难度提示 - 已掌握',
    description: '当用户已掌握当前概念时附加的提示。',
    defaultTemplate: '\n用户已较好掌握当前内容，可以引入新的相关概念或更高级的话题。',
    variables: [],
    exampleVars: {},
  },
  {
    id: 'agent.strategy.socratic',
    category: 'agent',
    feature: 'agent',
    role: 'system',
    title: '教学策略 - 苏格拉底式提问',
    description: '使用苏格拉底式提问时的策略提示。',
    defaultTemplate: '\n使用苏格拉底式提问，通过连续追问引导用户自己发现答案，而非直接给出结论。',
    variables: [],
    exampleVars: {},
  },
  {
    id: 'agent.strategy.feynman',
    category: 'agent',
    feature: 'agent',
    role: 'system',
    title: '教学策略 - 费曼学习法',
    description: '使用费曼学习法时的策略提示。',
    defaultTemplate: '\n使用费曼学习法：先用简单语言解释概念，然后让用户尝试用自己的话复述和解释，发现理解缺口后补充讲解。',
    variables: [],
    exampleVars: {},
  },
  {
    id: 'agent.strategy.assessment',
    category: 'agent',
    feature: 'agent',
    role: 'system',
    title: '教学策略 - 评估测试',
    description: '生成理解测试题时的策略提示。',
    defaultTemplate: '\n生成理解测试题，评估用户掌握程度，根据答题情况调整后续难度。',
    variables: [],
    exampleVars: {},
  },
  {
    id: 'ai.generateCards.system',
    category: 'ai',
    feature: 'generateCards',
    role: 'system',
    title: '生成卡片 - 系统提示',
    description: '将阅读笔记转化为复习卡片时的系统人设。',
    defaultTemplate: `你是一个专业的学习助手，负责将阅读笔记转化为高质量的复习卡片。

## 要求
1. 每张卡片有一个清晰的问题（front）和详细的答案（back）
2. 问题应该测试理解而非记忆，避免简单的"什么是X"类问题
3. 答案应该包含关键概念、解释和实际应用
4. 每张卡片附带2-3个相关标签，便于分类和检索
5. 返回JSON数组格式，确保JSON格式正确

## 卡片质量标准
- **front**: 应该是开放式问题，引导思考，而不是简单的填空
- **back**: 应该包含核心概念、解释、例子或应用场景
- **tags**: 应该反映卡片的主题和知识领域

## 输出格式
返回JSON数组，每个元素包含：
- front: 问题（字符串）
- back: 答案（字符串）
- tags: 标签数组（字符串数组）`,
    variables: [],
    exampleVars: { bookTitle: '深入理解计算机系统', highlightTexts: '[1] ...' },
  },
  {
    id: 'ai.generateCards.user',
    category: 'ai',
    feature: 'generateCards',
    role: 'user',
    title: '生成卡片 - 用户消息',
    description: '发送给 AI 的用户消息模板。变量：bookTitle, highlightTexts, count。',
    defaultTemplate: `请根据以下《{{bookTitle}}》的划线笔记生成复习卡片：

{{highlightTexts}}

请生成{{count}}张高质量的复习卡片，确保覆盖所有重要内容。
返回JSON数组格式。`,
    variables: [
      { name: 'bookTitle', description: '书籍标题', sample: '深入理解计算机系统' },
      { name: 'highlightTexts', description: '划线内容（已格式化）', sample: '[1] 内存是深度抽象...' },
      { name: 'count', description: '生成数量', sample: '5' },
    ],
    exampleVars: { bookTitle: '深入理解计算机系统', highlightTexts: '[1] 内存是深度抽象\n[2] 高速缓存是关键', count: '5' },
  },
  {
    id: 'ai.generateSummary.system',
    category: 'ai',
    feature: 'generateSummary',
    role: 'system',
    title: '生成摘要 - 系统提示',
    description: '生成书籍摘要时的系统人设。',
    defaultTemplate: `你是一个专业的书籍摘要助手，负责生成结构化的书籍摘要。

## 要求
1. 摘要应该简洁全面，约300-500字，概括书籍的核心思想
2. 关键要点应该列出5-10个核心观点，每个要点用一句话概括
3. 保持原书的核心思想和逻辑结构
4. 使用清晰的段落结构，便于阅读

## 输出格式
返回JSON对象，包含：
- summary: 摘要文本（字符串，300-500字）
- keyPoints: 关键要点数组（字符串数组，每个要点用一句话概括）`,
    variables: [],
    exampleVars: {},
  },
  {
    id: 'ai.generateSummary.user',
    category: 'ai',
    feature: 'generateSummary',
    role: 'user',
    title: '生成摘要 - 用户消息',
    description: '变量：bookTitle, highlightTexts。',
    defaultTemplate: `请根据以下《{{bookTitle}}》的划线内容生成摘要：

{{highlightTexts}}

请生成一份高质量的书籍摘要，帮助读者快速了解这本书的核心内容。`,
    variables: [
      { name: 'bookTitle', description: '书籍标题', sample: '人类简史' },
      { name: 'highlightTexts', description: '划线内容', sample: '[第一章] 农业革命...' },
    ],
    exampleVars: { bookTitle: '人类简史', highlightTexts: '[第一章] 农业革命是骗局' },
  },
  {
    id: 'ai.explainHighlight.system',
    category: 'ai',
    feature: 'explainHighlight',
    role: 'system',
    title: '解释划线 - 系统提示',
    description: '解释单条划线时的系统人设。',
    defaultTemplate: '你是一个知识解读助手，帮助用户理解阅读中的重要内容。请用简洁清晰的语言解释这段内容的核心含义、重要性和可能的应用场景。',
    variables: [],
    exampleVars: {},
  },
  {
    id: 'ai.explainHighlight.user',
    category: 'ai',
    feature: 'explainHighlight',
    role: 'user',
    title: '解释划线 - 用户消息',
    description: '变量：bookTitle, chapterTitle, content。',
    defaultTemplate: `请解释以下内容（来自《{{bookTitle}}》{{chapterTitle}}）：

{{content}}`,
    variables: [
      { name: 'bookTitle', description: '书籍标题', sample: '影响力' },
      { name: 'chapterTitle', description: '章节名（可空）', sample: '第3章 承诺与一致' },
      { name: 'content', description: '划线内容', sample: '承诺一旦做出，就会成为行为的驱动力' },
    ],
    exampleVars: { bookTitle: '影响力', chapterTitle: '第3章 承诺与一致', content: '承诺一旦做出...' },
  },
  {
    id: 'ai.chatWithContext.system',
    category: 'ai',
    feature: 'chatWithContext',
    role: 'system',
    title: '基于笔记的对话 - 系统提示',
    description: '基于用户笔记回答问题时的系统人设。',
    defaultTemplate: `你是一个智能阅读助手，基于用户的阅读笔记回答问题。
回答要求：
1. 基于提供的笔记内容回答
2. 如果笔记中没有相关信息，坦诚告知
3. 引用相关笔记内容作为支持
4. 保持友好专业的语气`,
    variables: [],
    exampleVars: {},
  },
  {
    id: 'ai.chatWithContext.user',
    category: 'ai',
    feature: 'chatWithContext',
    role: 'user',
    title: '基于笔记的对话 - 用户消息',
    description: '变量：contextText, question。',
    defaultTemplate: `我的阅读笔记：
{{contextText}}

问题：{{question}}`,
    variables: [
      { name: 'contextText', description: '检索到的笔记内容', sample: '...' },
      { name: 'question', description: '用户问题', sample: '什么是元认知？' },
    ],
    exampleVars: { contextText: '元认知是对自己思考的思考...', question: '什么是元认知？' },
  },
  {
    id: 'ai.extractMethodologies.system',
    category: 'ai',
    feature: 'extractMethodologies',
    role: 'system',
    title: '提取方法论 - 系统提示',
    description: '从笔记中提取方法论时的系统人设。',
    defaultTemplate: `你是一个专业的方法论提取助手，负责从书籍笔记中提取可执行的方法论。

## 要求
1. 识别笔记中蕴含的方法论、思维模型、操作流程
2. 每个方法论包含：名称、触发场景、描述、执行步骤、输出格式、示例
3. 方法论应该是可操作的，有明确的步骤和场景
4. 返回JSON数组格式

## 输出格式
返回JSON数组，每个元素包含：
- name: 方法论名称（字符串）
- nameEn: 英文名称（可选，字符串）
- triggerScenario: 触发场景（字符串）
- description: 描述（字符串）
- steps: 执行步骤（字符串数组）
- outputFormat: 输出格式（字符串）
- examples: 示例（字符串）
- tags: 标签数组（字符串数组）

## 重要
1. 必须返回合法的JSON格式，不要添加markdown代码块标记
2. 字符串中的双引号必须转义为 \\"
3. 字符串中的换行符必须转义为 \\n
4. 不要在JSON前后添加任何解释文字`,
    variables: [],
    exampleVars: {},
  },
  {
    id: 'ai.extractMethodologies.user',
    category: 'ai',
    feature: 'extractMethodologies',
    role: 'user',
    title: '提取方法论 - 用户消息',
    description: '变量：bookTitle, highlightTexts。',
    defaultTemplate: `请从《{{bookTitle}}》的以下笔记中提取方法论：

{{highlightTexts}}

请提取所有可操作的方法论，返回JSON数组格式。`,
    variables: [
      { name: 'bookTitle', description: '书籍标题', sample: '深度工作' },
      { name: 'highlightTexts', description: '划线内容', sample: '...' },
    ],
    exampleVars: { bookTitle: '深度工作', highlightTexts: '[1] 排除干扰...' },
  },
  {
    id: 'ai.analyzeBookArchitecture.system',
    category: 'ai',
    feature: 'analyzeBookArchitecture',
    role: 'system',
    title: '分析书籍架构 - 系统提示',
    description: '分析书籍架构时的系统人设。',
    defaultTemplate: `你是一个专业的书籍架构分析助手，负责分析书籍的认知框架和方法论架构。

## 要求
1. 提取书籍的核心命题（一句话概括全书主旨）
2. 分析认知框架（作者如何组织思想）
3. 梳理方法论架构（书中的方法论体系）
4. 构建知识层次（知识点之间的层级关系）
5. 识别目标读者群体
6. 返回JSON对象格式

## 输出格式
返回JSON对象，包含：
- coreProposition: 核心命题（字符串）
- cognitiveFramework: 认知框架（对象）
- methodologyArchitecture: 方法论架构（对象）
- knowledgeHierarchy: 知识层次（对象）
- targetAudience: 目标读者（字符串）

## 重要
1. 必须返回合法的JSON格式，不要添加markdown代码块标记
2. 字符串中的双引号必须转义为 \\"
3. 字符串中的换行符必须转义为 \\n
4. 不要在JSON前后添加任何解释文字`,
    variables: [],
    exampleVars: {},
  },
  {
    id: 'ai.analyzeBookArchitecture.user',
    category: 'ai',
    feature: 'analyzeBookArchitecture',
    role: 'user',
    title: '分析书籍架构 - 用户消息',
    description: '变量：bookTitle, highlightTexts。',
    defaultTemplate: `请分析《{{bookTitle}}》的架构，基于以下笔记：

{{highlightTexts}}

请返回JSON格式。`,
    variables: [
      { name: 'bookTitle', description: '书籍标题', sample: '思考，快与慢' },
      { name: 'highlightTexts', description: '划线内容', sample: '...' },
    ],
    exampleVars: { bookTitle: '思考，快与慢', highlightTexts: '[1] 系统1快速...' },
  },
  {
    id: 'ai.distillKnowledgeCards.system',
    category: 'ai',
    feature: 'distillKnowledgeCards',
    role: 'system',
    title: '蒸馏知识卡片 - 系统提示',
    description: '蒸馏知识卡片时的系统人设。',
    defaultTemplate: `你是一个知识蒸馏助手，负责将阅读笔记转化为结构化的知识卡片。

## 要求
1. 将笔记蒸馏为三种类型的知识卡片：
   - concept: 核心概念卡片（概念定义、关键术语）
   - methodology: 方法论卡片（操作步骤、思维模型）
   - quote: 金句卡片（精彩原文、启发性语句）
2. 每张卡片包含：标题、内容、解读、应用场景、标签
3. 解读要深入浅出，应用场景要具体
4. 返回JSON数组格式

## 输出格式
返回JSON数组，每个元素包含：
- type: 卡片类型（"concept" | "methodology" | "quote"）
- title: 标题（字符串）
- content: 内容（字符串）
- interpretation: 解读（字符串）
- application: 应用场景（字符串）
- tags: 标签数组（字符串数组）

## 重要
1. 必须返回合法的JSON格式，不要添加markdown代码块标记
2. 字符串中的双引号必须转义为 \\"
3. 字符串中的换行符必须转义为 \\n
4. 不要在JSON前后添加任何解释文字`,
    variables: [],
    exampleVars: {},
  },
  {
    id: 'ai.distillKnowledgeCards.user',
    category: 'ai',
    feature: 'distillKnowledgeCards',
    role: 'user',
    title: '蒸馏知识卡片 - 用户消息',
    description: '变量：bookTitle, highlightTexts。',
    defaultTemplate: `请从《{{bookTitle}}》的以下笔记中蒸馏知识卡片：

{{highlightTexts}}

请蒸馏出高质量的知识卡片，返回JSON数组格式。`,
    variables: [
      { name: 'bookTitle', description: '书籍标题', sample: '认知觉醒' },
      { name: 'highlightTexts', description: '划线内容', sample: '...' },
    ],
    exampleVars: { bookTitle: '认知觉醒', highlightTexts: '[1] 元认知...' },
  },
  {
    id: 'ai.generateCardInterpretation.system',
    category: 'ai',
    feature: 'generateCardInterpretation',
    role: 'system',
    title: '生成知识卡片解读 - 系统提示',
    description: '为知识卡片生成深度解读时的系统人设。',
    defaultTemplate: `你是一个知识解读助手，负责为用户的知识卡片生成深入浅出的解读。

## 要求
1. 解读要基于卡片内容，帮助用户深入理解其含义
2. 语言通俗易懂，避免过于学术化
3. 可以联系相关概念或背景知识进行说明
4. 控制在 150-300 字
5. 直接返回纯文本，不要添加标题或格式标记`,
    variables: [],
    exampleVars: {},
  },
  {
    id: 'ai.generateCardInterpretation.user',
    category: 'ai',
    feature: 'generateCardInterpretation',
    role: 'user',
    title: '生成知识卡片解读 - 用户消息',
    description: '变量：bookTitle, cardTitle, cardContent, cardType。',
    defaultTemplate: `请为以下知识卡片生成解读：

来源书籍：《{{bookTitle}}》
卡片类型：{{cardType}}
卡片标题：{{cardTitle}}
卡片内容：{{cardContent}}

请生成一段深入浅出的解读，帮助理解这个知识点的核心含义。`,
    variables: [
      { name: 'bookTitle', description: '书籍标题', sample: '认知觉醒' },
      { name: 'cardType', description: '卡片类型', sample: '概念' },
      { name: 'cardTitle', description: '卡片标题', sample: '元认知' },
      { name: 'cardContent', description: '卡片内容', sample: '元认知是对自己思考的思考...' },
    ],
    exampleVars: { bookTitle: '认知觉醒', cardType: '概念', cardTitle: '元认知', cardContent: '元认知是对自己思考的思考' },
  },
  {
    id: 'ai.generateCardApplication.system',
    category: 'ai',
    feature: 'generateCardApplication',
    role: 'system',
    title: '生成知识卡片应用场景 - 系统提示',
    description: '为知识卡片生成应用场景时的系统人设。',
    defaultTemplate: `你是一个知识应用助手，负责为用户的知识卡片生成具体的应用场景。

## 要求
1. 场景要具体、可执行，不要泛泛而谈
2. 提供 2-3 个不同场景的应用示例
3. 每个场景说明：在什么情况下使用、具体怎么做、预期效果
4. 控制在 150-300 字
5. 直接返回纯文本，不要添加标题或格式标记`,
    variables: [],
    exampleVars: {},
  },
  {
    id: 'ai.generateCardApplication.user',
    category: 'ai',
    feature: 'generateCardApplication',
    role: 'user',
    title: '生成知识卡片应用场景 - 用户消息',
    description: '变量：bookTitle, cardTitle, cardContent, cardType。',
    defaultTemplate: `请为以下知识卡片生成应用场景：

来源书籍：《{{bookTitle}}》
卡片类型：{{cardType}}
卡片标题：{{cardTitle}}
卡片内容：{{cardContent}}

请生成具体的应用场景，说明这个知识如何在实际生活或工作中运用。`,
    variables: [
      { name: 'bookTitle', description: '书籍标题', sample: '深度工作' },
      { name: 'cardType', description: '卡片类型', sample: '方法论' },
      { name: 'cardTitle', description: '卡片标题', sample: '番茄工作法' },
      { name: 'cardContent', description: '卡片内容', sample: '25分钟专注+5分钟休息...' },
    ],
    exampleVars: { bookTitle: '深度工作', cardType: '方法论', cardTitle: '番茄工作法', cardContent: '25分钟专注+5分钟休息' },
  },
  {
    id: 'ai.generateSkill.system',
    category: 'ai',
    feature: 'generateSkill',
    role: 'system',
    title: '生成 Skill - 系统提示',
    description: '将方法论转化为 Skill 时的系统人设。',
    defaultTemplate: `你是一个 Skill 生成助手，负责将方法论转化为可安装的 Skill 文件。

## 要求
1. 生成符合 book-methodology-skills 规范的 Skill 文件
2. Skill 文件包含：名称、触发场景、步骤、输出格式、示例
3. 使用 YAML 格式
4. 确保 Skill 可以直接安装使用`,
    variables: [],
    exampleVars: {},
  },
  {
    id: 'ai.generateSkill.user',
    category: 'ai',
    feature: 'generateSkill',
    role: 'user',
    title: '生成 Skill - 用户消息',
    description: '变量：methodology 对象的各字段。',
    defaultTemplate: `请为以下方法论生成 Skill 文件：

名称: {{name}}
{{nameEn}}触发场景: {{triggerScenario}}
描述: {{description}}
步骤: {{steps}}
输出格式: {{outputFormat}}
示例: {{examples}}

请生成 YAML 格式的 Skill 文件内容。`,
    variables: [
      { name: 'name', description: '方法论名称', sample: '番茄工作法' },
      { name: 'nameEn', description: '英文名称行（可空）', sample: '英文名称: Pomodoro Technique\\n' },
      { name: 'triggerScenario', description: '触发场景', sample: '需要专注工作时' },
      { name: 'description', description: '描述', sample: '一种时间管理方法' },
      { name: 'steps', description: '步骤（换行分隔）', sample: '1. 设置 25 分钟...' },
      { name: 'outputFormat', description: '输出格式', sample: '任务清单' },
      { name: 'examples', description: '示例', sample: '...' },
    ],
    exampleVars: { name: '番茄工作法', nameEn: '英文名称: Pomodoro Technique\\n', triggerScenario: '需要专注', description: '时间管理', steps: '1. 25 分钟', outputFormat: '清单', examples: '...' },
  },
]

const REGISTRY_BY_ID: Map<string, PromptMeta> = new Map()
for (const p of PROMPT_REGISTRY) REGISTRY_BY_ID.set(p.id, p)

export function getPromptMeta(id: string): PromptMeta | undefined {
  return REGISTRY_BY_ID.get(id)
}

export function getAllPromptIds(): string[] {
  return PROMPT_REGISTRY.map(p => p.id)
}

export function getPromptsByCategory(category: PromptCategory): PromptMeta[] {
  return PROMPT_REGISTRY.filter(p => p.category === category)
}

export function getPromptsByFeature(feature: string): PromptMeta[] {
  return PROMPT_REGISTRY.filter(p => p.feature === feature)
}

logger.debug(`PromptRegistry loaded: ${PROMPT_REGISTRY.length} prompts`)
