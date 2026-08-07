# Model Gateway v0.1

## 1. 已确认的目标

模型中枢负责统一模型身份、能力、参数校验和协议转换。产品功能与 Agent 只引用稳定的 `modelId`，不自行决定 Provider、Base URL、远端模型名或请求路径。

当前确认的分层：

```text
产品功能 / Agent
        ↓ 统一请求
Model Gateway
        ↓ 查询
Model Registry
        ↓ 选择协议 Adapter
Mock / OpenAI-compatible / Gemini / 异步媒体任务
```

Provider、Protocol 和 Model 必须分开：

- Provider：账户、凭据和 API 服务来源；
- Protocol：请求与返回格式，例如 `openai-chat`；
- Model：稳定产品 ID、远端模型名、能力和参数规则。

## 2. 当前完成范围

### Model Registry

- 注册 Provider 和 Model；
- 校验稳定 ID；
- 校验 Provider 是否支持模型声明的协议；
- 按 Capability 查询模型；
- 校验模型是否支持 Chat、Tool Calling、图片或视频能力；
- 应用默认参数；
- 拒绝未知参数、错误类型和越界数值；
- 返回副本，避免调用方修改注册表内部数据。

### 统一调用契约

- v0.1 的统一调用只覆盖 Chat；图片和视频当前仅登记能力，不进入 Chat 请求结构；
- 统一消息角色；
- 统一 Tool 定义；
- 统一 Tool Call；
- 统一正常回复和 Tool Call 结束原因；
- 统一结构化错误代码。

### Mock Adapter

当前提供三个不联网的模型：

- `mock.chat.basic`：普通文本回复；
- `mock.chat.tool-use`：返回规范化 Tool Call；
- `mock.chat.error`：稳定模拟 Provider 失败。

### OpenAI-compatible 协议适配

已经验证以下双向转换，但尚未发送真实 HTTP 请求：

- 统一消息 → Chat Completions messages；
- 统一 Tool → OpenAI function tool；
- `temperature`、`max_tokens` → Provider 参数；
- Provider `tool_calls` → 统一 Tool Call；
- Assistant Tool Call 与 `role=tool` 结果的第二轮回传；
- Provider Usage → 统一 Token Usage。

### Trace

每次 `ModelGateway.invoke()` 都会生成独立 `traceId`，并经历：

```text
running → succeeded / failed
```

Trace 当前记录：

- 原始统一请求；
- 最终选择的 Provider、Protocol 和远端模型名；
- 应用默认值后的规范化参数；
- Messages、Tools、Tool Call 与 Tool Result；
- 统一响应和 Token Usage；
- 开始、结束时间与耗时；
- 结构化错误、HTTP 状态和是否建议重试。

Trace Store 在写入时统一深层复制和脱敏。`apiKey`、`Authorization`、Access Token、Refresh Token、Client Secret、Password、Bearer Token 以及常见 Key 字符串不会以明文保存。JSON Schema 中名为 `token` 的字段定义不会被误删。

Mock 已覆盖普通失败、超时、401、404 和 429，并明确区分是否可重试。

## 3. 当前明确不包含

- 不读取或保存真实 API Key；
- 不发起真实网络请求；
- 不替换现有线上聊天 Agent；
- 不改变当前图片、视频生成链路；
- 不实现 Trace 可视化和持久化，当前只提供内存 Trace Store；
- 不接 Pi Agent Loop；
- 不把图片和视频强行包装成 Chat Completions。

## 4. 下一切片

下一步进入 C3：为已经完成契约测试的 OpenAI-compatible Adapter 增加真实 HTTP Transport 和 Provider 运行时配置，再把现有 Chat / Tool Calling 逐步切换到 Gateway。真实请求必须单独获得授权；图片、视频和 Pi Agent Loop 继续后置。
