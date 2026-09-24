## 变更类型

- [ ] feat（新功能）
- [ ] fix（Bug 修复）
- [ ] docs（文档）
- [ ] refactor（重构）
- [ ] test（测试）
- [ ] chore（杂项）

## 变更说明

<!-- 说清「为什么改」而不只是「改了什么」。一条 PR 只做一件事；改了不少于一件事请拆开。 -->

## 关联 Issue

Closes #<issue 编号>

## 我验证过什么

**请照实填，包括没验的部分。** 这个项目的一条硬规矩是：没有实测过的东西不写成已经好了。

- [ ] `npm run verify` 全绿（lint / typecheck / test:cov / build）
- 门禁实跑结果（把用例数、eslint error/warning 数、typecheck 结果贴出来）：

```
$ npm run verify

```

- **没验的是什么**（界面没点开过？装机版没实跑过？某条链路只在 dev 环境验过？）：

## 本仓库的守卫（新增代码会被这些测试咬）

- [ ] 没有新增 `as unknown as XxxRow`：数据库行只过 `src/renderer/src/utils/db-mapper.ts` 一处（`tests/db-row-types.test.ts`）
- [ ] 没有写死 IPC 通道字符串：一律 `IPC_CHANNELS.X.Y`（`tests/ipc-channels.test.ts`）
- [ ] 界面上每个数字都能追到真实数据库列，追不到的宁可不显示（`tests/no-fake-controls.test.ts`）
- [ ] 改到色值：改 `tokens/brand.json` 后跑 `npm run build:tokens`，产物一起提交（`tests/design-tokens.test.ts`）
- [ ] 改到徽标：跑 `npm run build:icons`（`tests/brand-assets.test.ts`）
- [ ] 涉及 AI 调用：启动 / 通知 / 后台链路只做本地计算，不新增自动花钱的通路
- [ ] 发版类改动：六处版本同步点都跟上了（`tests/version-sync.test.ts`）

## 截图 / 录屏

<!-- 只有界面真的变了才需要；纯逻辑改动不需要，也不用为了填这栏去截图。 -->
