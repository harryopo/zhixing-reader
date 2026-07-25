/**
 * External Links — 集中管理所有外部 URL
 *
 * 修改 GitHub 用户名或飞书问卷链接只需改这一处。
 * 所有页面都从这里导入，避免 URL 散落各处。
 */

// ====================================================================
// ⚠️  开源前必改：把下面的 GitHub 用户名改成你的
// ====================================================================
export const GITHUB_USERNAME = 'harryopo'
export const GITHUB_REPO_NAME = 'zhixing-reader'
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_USERNAME}/${GITHUB_REPO_NAME}`

// GitHub Releases API — 检查更新用
export const GITHUB_RELEASES_API = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO_NAME}/releases/latest`
export const GITHUB_RELEASES_PAGE = `${GITHUB_REPO_URL}/releases`

// Issues — 问题反馈
export const GITHUB_ISSUES_URL = `${GITHUB_REPO_URL}/issues`

// 问题反馈 — 使用 GitHub Issues 代替飞书问卷
export const FEEDBACK_SURVEY_URL = GITHUB_ISSUES_URL

// 说明文档（GitHub Pages 或仓库内 docs）
export const DOCS_URL = `${GITHUB_REPO_URL}#readme`
export const SETTINGS_TUTORIAL_URL = `${GITHUB_REPO_URL}/blob/main/docs/settings-tutorial.md`

// 隐私政策
export const PRIVACY_POLICY_URL = `${GITHUB_REPO_URL}/blob/main/PRIVACY.md`

// 开源许可证
export const LICENSE_TYPE = 'MIT'
export const LICENSE_URL = `${GITHUB_REPO_URL}/blob/main/LICENSE`

// 应用元信息
export const APP_META = {
  name: '知行读书',
  version: 'v1.0.0',
  releaseDate: '2026-07-25',
  description: '为阅读成长而生的智能学习工具',
  author: '张子涵',
  copyright: `© 2026 ${APP_META_AUTHOR()}`,
  techStack: ['Electron 35', 'React 19', 'TypeScript', 'Tailwind CSS 4'],
} as const

function APP_META_AUTHOR(): string {
  return '知行读书'
}

// 反馈与帮助入口配置
export interface FeedbackTileConfig {
  title: string
  hint: string
  icon: 'message-circle' | 'file' | 'question'
  domId: string
  url: string
}

export const FEEDBACK_TILES: FeedbackTileConfig[] = [
  {
    title: '问题反馈',
    hint: '填写飞书问卷，帮助我们改进',
    icon: 'message-circle',
    domId: 'cta-feedback',
    url: FEEDBACK_SURVEY_URL,
  },
  {
    title: '使用文档',
    hint: '查看功能说明与使用指南',
    icon: 'file',
    domId: 'cta-docs',
    url: SETTINGS_TUTORIAL_URL,
  },
  {
    title: '常见问题',
    hint: '在 GitHub Issues 中查找答案',
    icon: 'question',
    domId: 'cta-faq',
    url: GITHUB_ISSUES_URL,
  },
]
