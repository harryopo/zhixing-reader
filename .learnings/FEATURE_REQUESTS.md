# Feature Requests

知行读书项目功能需求记录。

---

## [FEAT-20260529-001] api-config

**Logged**: 2026-05-29T16:05:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Requested Capability
API 配置的持久化和自动加载

### User Context
用户需要保存微信读书 API Key 和 AI 服务配置，重启应用后自动生效。

### Complexity Estimate
medium

### Suggested Implementation
1. 使用 settings.json 存储配置
2. 应用启动时加载配置到内存
3. 保存时同步更新文件和内存

### Metadata
- Frequency: recurring
- Related Features: 设置页面、API 测试

---

## [FEAT-20260529-002] custom-ai

**Logged**: 2026-05-29T16:05:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Requested Capability
支持自定义 AI 服务提供商

### User Context
用户不想局限于 OpenAI/Anthropic，需要支持任何兼容 OpenAI 接口的服务（如 DeepSeek、通义千问、Ollama 等）。

### Complexity Estimate
simple

### Suggested Implementation
1. 移除 OpenAI/Anthropic 预设按钮
2. 只保留自定义配置输入框
3. 输入框使用浅色 placeholder 示例

### Metadata
- Frequency: first_time
- Related Features: AI 服务配置

---

## [FEAT-20260529-003] toast-notification

**Logged**: 2026-05-29T16:05:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Requested Capability
Toast 通知系统

### User Context
需要在操作成功/失败时显示友好的提示信息。

### Complexity Estimate
medium

### Suggested Implementation
1. 创建全局 toast store (Zustand)
2. 创建 Toast UI 组件
3. 支持 success/error/warning/info/loading 类型

### Metadata
- Frequency: first_time
- Related Features: 所有操作反馈

---

## [FEAT-20260529-004] port-config

**Logged**: 2026-05-29T16:05:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: config

### Requested Capability
避免端口冲突

### User Context
用户同时开发多个项目，需要避免端口占用。

### Complexity Estimate
simple

### Suggested Implementation
1. 修改 electron.vite.config.ts 设置 renderer 端口
2. 修改 main.ts 使用环境变量或默认端口

### Metadata
- Frequency: first_time
- Related Features: 开发环境配置

---
