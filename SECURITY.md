# 安全策略（Security Policy）

> 知行读书是**本地优先**的桌面应用：数据全部存在用户自己的机器上，唯一的对外网络请求是用户主动配置的 AI 服务商调用与微信读书同步。

**请先把这类问题和普通 Bug 分开：**

- 功能不对、界面异常、同步失败、复习数字对不上 → 走 [Issue 模板](https://github.com/harryopo/zhixing-reader/issues/new/choose)。
- 涉及密钥、越权、注入、数据被读到本机之外、安装包被篡改 → 按本文件的私享渠道，**不要**公开发在 Issue 里。

## 如何上报安全问题

1. 打开仓库 **Security** 页 → **Report a vulnerability**（GitHub 私有漏洞报告表单），提交前请在表单里选择 "Disclosures are handled privately"。这条通道创建的是只有你和维护者可见的私有 advisory。
2. 如果这个表单在你的账号下不可用，请开一个只写「**安全问题，请通过私有渠道联系我**」的 Issue（**不要在 Issue 正文里写任何细节**），我会随即开私有 advisory 把你拉进去。

### 上报时请一并给出

| 项 | 说明 |
|----|------|
| 版本 | 「设置 → 关于」里的版本号（如 v1.3.4），以及是安装包还是 `npm run dev` |
| 平台 | Windows 版本、是否以管理员身份运行 |
| 影响面 | 需要用户做什么操作才能触发（本地文件？恶意书籍元数据？恶意导入的 CSV？）|
| 复现 | 最小复现步骤或 PoC；请**脱敏**，不要把真实 API Key 贴进来 |

## 响应时限

| 阶段 | 目标 |
|------|------|
| 确认收到 | 3 个工作日内 |
| 定性（是不是问题、严重度） | 7 个工作日内 |
| 修复并随版本发布 | 高危优先安排补丁版本；中低危并入下一个常规版本 |

这是一个人的开源项目，没有 SLA 承诺、没有安全团队。以上是我能给的现实目标；如果你愿意，欢迎附上补丁，我们一起把时间压短。

## 这个项目的安全边界（现状，以 v1.3.4 代码为准）

**已经做的**：

| 措施 | 落点 |
|------|------|
| Electron 进程隔离 | `electron/main.ts`：`contextIsolation: true`、`nodeIntegration: false`。渲染层只能通过 `electron/preload.ts` 暴露的方法访问主进程。**`sandbox` 是关的**（preload 需要 Node 能力），所以这一层靠的是 contextBridge 边界而不是 OS 沙箱 |
| IPC 通道集中定义 | `src/shared/ipc-channels.ts`（164 条），渲染层写死通道字符串会被 `tests/ipc-channels.test.ts` 判红 |
| SQL 值全走占位符 | `electron/database/**` 与 `electron/repositories/**` 的取值一律用 `?`；动态表名只出现在后台管理页，走白名单正则过滤并拒绝 `sqlite_*` 内部表（`electron/admin.ts`）|
| API Key 走系统加密 | Electron `safeStorage`（Windows DPAPI）；`isEncryptionAvailable()` 为 false 时如实告知密钥将以明文保存，不做静默降级（`electron/services/settings-service.ts`）|
| 日志脱敏 | `electron/logger.ts` 的 `redactSensitive()` 递归遍历对象/数组，命中敏感键名的非空字符串值替换为 `[REDACTED]` |
| 自动更新校验 | electron-updater 按 `latest.yml` 的 sha512 校验安装包，校验不过不装 |
| 仓库侧 | GitHub Secret Scanning + Push Protection 已开启（`secret_scanning_push_protection: enabled`）|

**已知的限制（不是漏洞报告的重点，是现状）**：

| 限制 | 说明 |
|------|------|
| 智能体编排 / 后台管理页没有访问口令 | 「设置 → 智能体编排」有真入口；`/admin` 没有界面入口但路由仍在应用包里。共用电脑的人都能进，包括改提示词模板（[#2](https://github.com/harryopo/zhixing-reader/issues/2)）|
| 只出 Windows 安装包 | 没有 macOS / Linux 的打包与代码签名，也没有 Windows 代码签名证书 —— 首次安装时 SmartScreen 会告警（[#5](https://github.com/harryopo/zhixing-reader/issues/5)）|
| 系统加密不可用时密钥为明文 | 如实告知，不做静默降级 |

## 不受本策略覆盖的范围

- 微信读书账号自身的凭据安全、其接口变更导致的问题。
- 你所选择的 AI 服务商的响应内容与合规性。
- 已被你主动导出或分享出去的数据。
