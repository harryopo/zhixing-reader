# 常见问题（FAQ）

> 适用版本：v1.0.0 | 最后更新：2026-07-27
> 没找到答案？去 [GitHub Issues](https://github.com/harryopo/zhixing-reader/issues) 搜索或提问。

---

## 一、安装与更新

### Q1：在哪里下载安装包？
从 [GitHub Releases](https://github.com/harryopo/zhixing-reader/releases) 下载最新的 `ZhixingReader-Setup-x.y.z.exe`（约 125MB），双击安装即可。

### Q2：为什么安装包这么大？
主要来自 Electron 运行时 + sql.js WASM 引擎 + ECharts 图表库，这是 Electron 桌面应用的正常体积。

### Q3：支持 macOS / Linux 吗？
当前仅提供 Windows 安装包。macOS / Linux 需要克隆仓库后自行构建（`npm install && npm run package`），欢迎贡献跨平台打包配置。

### Q4：如何更新到新版本？
应用会通过 GitHub Releases API 自动检查更新并提示；也可以手动到 Releases 页面下载新版安装包覆盖安装，本地数据不会丢失。

---

## 二、数据与隐私

### Q5：我的数据存在哪里？会上传吗？
所有数据（书架、划线、笔记、卡片、对话记录）都存储在**本地 SQLite 数据库**（sql.js），不上传任何服务器。应用不包含分析、追踪或广告 SDK。详见 [PRIVACY.md](PRIVACY.md)。

### Q6：如何备份数据？
直接复制本地数据库文件 `zhixing.db` 即可完整备份；也可以在应用内使用导出功能（笔记导出 Markdown、生词本导出 CSV/Anki）。

### Q7：支持离线使用吗？
支持。除微信读书同步和 AI 对话需要联网外，复习、笔记、知识卡片、统计等功能均可离线使用。

---

## 三、微信读书同步

### Q8：如何连接微信读书？
进入 **设置 → 微信读书**，填入微信读书开放平台的 API Key，点击 **测试连接**，成功后点击 **同步书架**。

### Q9：同步失败怎么办？
按顺序排查：
1. 检查 API Key 是否有效、是否过期
2. 检查网络连接
3. 是否触发了微信读书 API 频率限制（稍后重试）
4. 在设置页点击 **立即同步** 手动触发

### Q10：多久自动同步一次？
默认每 15 分钟自动同步一次，可在设置中调整为 15 分钟 / 30 分钟 / 1 小时，也可随时手动同步。同步为增量模式，不会重复拉取全量数据。

---

## 四、AI 功能

### Q11：AI 对话需要自己的 API Key 吗？
需要。进入 **设置 → AI 配置** 填入你的 AI 服务商 API Key，支持 DeepSeek、OpenAI、Anthropic、Moonshot 等。Key 加密保存在本地，请求直连 AI 服务商，不经过任何中转服务器。

### Q12：什么是"深度思考"模式？
开启后会展示 AI 的推理过程（支持 DeepSeek R1 `reasoning_content`、OpenAI reasoning、Claude thinking 三种格式），适合需要看推理链的深度学习场景。

### Q13：AI 对话和普通聊天机器人有什么区别？
知行读书的智能体会根据你的意图自动切换教学策略：
- **直接回答**：知识查询、概念解释
- **苏格拉底追问**：深度讨论时通过提问引导你思考
- **费曼复述**：让你用简单语言解释概念，检验掌握程度

同时自动注入 5 维上下文（书籍内容 / 知识卡片 / 记忆 / 方法论 / 用户画像），回答基于你真实读过的内容。

### Q14：一次对话消耗多少 Token？
约 500–2000 tokens（取决于上下文和回复长度）。可在 **Token 监控** 页面查看各服务商、各功能的详细用量统计。

---

## 五、复习与学习

### Q15：复习算法是什么？和 Anki 一样吗？
采用 **FSRS v5** 算法（基于 `ts-fsrs@5.4.1`，open-spaced-repetition 官方实现），与 Anki 23.10+ 同源，19 组标准权重的 DSR 模型。卡片数据结构与 Anki 兼容，可导出到 Anki。

### Q16：复习评分怎么选？
- `1` 忘记：完全想不起来
- `2` 困难：想起来了但很吃力
- `3` 良好：正常想起（大多数情况选这个）
- `4` 简单：毫不费力

算法会根据评分自动调整下次复习时间，不需要人工规划。

### Q17：生词本怎么用？
阅读英文内容时选中单词点击 **添加到生词本**，系统自动查询释义（内置约 8 万词的本地词典，离线可查）。生词按独立的记忆算法调度复习，支持导出 CSV / Anki 格式。

---

## 六、故障排查

### Q18：应用启动后白屏 / 打不开怎么办？
1. 完全退出后重新启动
2. 检查杀毒软件是否拦截了应用
3. 重新安装最新版本
4. 仍有问题请到 [Issues](https://github.com/harryopo/zhixing-reader/issues) 反馈，附上系统版本和复现步骤

### Q19：如何反馈 Bug 或提功能建议？
到 [GitHub Issues](https://github.com/harryopo/zhixing-reader/issues) 提交，描述清楚：使用版本、操作步骤、预期行为、实际行为（最好附截图）。

### Q20：如何参与贡献？
阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解开发环境搭建和 PR 流程，提交前确保 `npm run verify` 全绿（lint / typecheck / test / build）。

---

*本 FAQ 随版本更新维护，欢迎通过 Issue 补充新问题。*
