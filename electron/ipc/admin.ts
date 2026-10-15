/**
 * ipc/admin — 管理后台 handlers
 * 从原 ipc.ts 拆分而来，逻辑保持不变。
 */
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import * as admin from '../admin';
import { isDev } from '../user-data';
import type { HandleFn } from './types';

/**
 * 装机版也注册的这 8 条不是"后台专用"，是设置页的后台：
 * SettingsAgent（系统提示词）、SettingsAI（自定义模板增删改）、SettingsData（KPI 读数）。
 * 所以这一半不能跟着开发闸门一起关掉 —— 2026-10-10 先查过生产者才动的，
 * 只按"这是 admin 通道"整组收就会把设置页三条链一起打断。
 */
export function registerAdminHandlers(handle: HandleFn): void {
  /**
   * 只交 `stats`：装机版唯一的消费者 SettingsData 三处读的全是 `result.stats`，
   * 而这里原来还顺手查了 7 天 token 趋势与最近 5 条会话整行带出去 —— 那两个字段
   * 全场只有后台概览页的兜底字面量里出现过，没人读，却每次进设置页都真跑两条 SQL，
   * 并把对话数据送进渲染层。会话与趋势本来就是下面开发专用那一半的读法。
   */
  handle(IPC_CHANNELS.ADMIN.GET_STATS, () => {
    return { stats: admin.getAdminStats() }
  })
  handle(IPC_CHANNELS.ADMIN.GET_AGENT_CONFIG, () => {
    return admin.getAgentConfig()
  })
  handle(IPC_CHANNELS.ADMIN.SAVE_PROMPT, (id: string, template: string) => {
    return admin.saveAdminPrompt(id, template)
  })
  handle(IPC_CHANNELS.ADMIN.RESET_PROMPT, (id: string) => {
    return admin.resetAdminPrompt(id)
  })
  handle(IPC_CHANNELS.ADMIN.CREATE_CUSTOM_PROMPT, (name: string, content: string) => {
    return admin.createAdminCustomPrompt(name, content)
  })
  handle(IPC_CHANNELS.ADMIN.UPDATE_CUSTOM_PROMPT, (id: string, name: string, content: string) => {
    return admin.updateAdminCustomPrompt(id, name, content)
  })
  handle(IPC_CHANNELS.ADMIN.DELETE_CUSTOM_PROMPT, (id: string) => {
    return admin.deleteAdminCustomPrompt(id)
  })
  handle(IPC_CHANNELS.ADMIN.GET_CUSTOM_PROMPTS, () => {
    return admin.getAllAdminCustomPrompts()
  })

  registerInspectionHandlers(handle)
}

/**
 * 后台页专用的读数 —— **装机版一条都不注册**。
 *
 * 这批的读法是"给我任意一张表 / 库里全部会话与消息 / 整批提示词的导入导出"，
 * 界面侧只有 `pages/admin/` 在用（那个页本身已经是开发构建专属，见 App.tsx 的
 * `import.meta.env.DEV`）。上一批把页面挡在产物外之后，这几条通道在安装版里仍然
 * 全部可达：开着的那份菜单里有「开发者工具」，控制台一句
 * `window.electronAPI.admin.getTableData('conversations')` 就能把读书记录整张表读出来。
 * 现在闸门放在注册这一层 —— 装机版没人接这些通道，preload 上那几个同名方法留着也只是
 * 一条 reject，读不到任何数据。判据在 `tests/admin-ipc-dev-only.test.ts`（两种形状各钉一边，
 * 另有一条"新页面接到被关掉的方法上就判红"的对账守卫）。
 */
function registerInspectionHandlers(handle: HandleFn): void {
  if (!isDev) return

  handle(IPC_CHANNELS.ADMIN.GET_BOOKS_WITH_COUNTS, () => {
    return admin.getBooksWithCounts()
  })
  handle(IPC_CHANNELS.ADMIN.GET_HIGHLIGHTS_BY_BOOK, (bookId: string) => {
    return admin.getHighlightsByBook(bookId)
  })
  handle(IPC_CHANNELS.ADMIN.GET_CARDS_BY_BOOK, (bookId: string) => {
    return admin.getCardsByBook(bookId)
  })
  handle(IPC_CHANNELS.ADMIN.GET_SESSIONS, () => {
    return admin.getAdminSessions()
  })
  handle(IPC_CHANNELS.ADMIN.GET_SESSION_MESSAGES, (sessionId: string) => {
    return admin.getAdminSessionMessages(sessionId)
  })
  /**
   * 提示词中心要的列表（内置模板 + 用户改过的覆盖）。
   * 这条注册一直没写：preload 暴露了 `admin.getPrompts()`、页面也在调，主进程没人接
   * ⇒ 后台一进「提示词」就是一条 reject。`tests/ipc-channel-wiring.test.ts` 现在钉住了这个形状。
   */
  handle(IPC_CHANNELS.ADMIN.GET_PROMPTS, () => admin.getAllAdminPrompts())
  handle(IPC_CHANNELS.ADMIN.RESET_ALL_PROMPTS, () => {
    return admin.resetAllAdminPrompts()
  })
  handle(IPC_CHANNELS.ADMIN.EXPORT_PROMPTS, () => {
    return admin.exportAdminPrompts()
  })
  handle(IPC_CHANNELS.ADMIN.IMPORT_PROMPTS, (json: string) => {
    return admin.importAdminPrompts(json)
  })
  handle(IPC_CHANNELS.ADMIN.GET_DATABASE_SCHEMA, () => {
    return admin.getDatabaseSchema()
  })
  handle(IPC_CHANNELS.ADMIN.GET_TABLE_DATA, (tableName: string, limit?: number, offset?: number) => {
    return admin.getDatabaseTableData(tableName, limit, offset)
  })
}
