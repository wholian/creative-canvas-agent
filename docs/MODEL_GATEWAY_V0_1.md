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

已经验证以下双向转换：

- 统一消息 → Chat Completions messages；
- 统一 Tool → OpenAI function tool；
- `temperature`、`max_tokens` → Provider 参数；
- Provider `tool_calls` → 统一 Tool Call；
- Assistant Tool Call 与 `role=tool` 结果的第二轮回传；
- Provider Usage → 统一 Token Usage。

### Provider Runtime 与 HTTP Transport

Provider 的运行时连接信息与 Model Registry 分开管理：

- Model Registry 只保存稳定 `providerId`、协议、模型能力和远端模型名；
- Provider Runtime 保存 Base URL、API Key 和请求超时；
- 同一个 OpenAI-compatible Transport 可以根据 `providerId` 路由多个三方接口；
- 调用场景不自行拼接请求路径；Transport 只在规范化 Base URL 后追加一次 `/chat/completions`；
- 如果误填完整 `/chat/completions` 地址，会先规范化，避免重复拼接；
- 如果误填 Anthropic `/messages` 地址、URL 内凭据、Query 或 Fragment，会在联网前拒绝；
- 请求采用 JSON POST、Bearer Authorization 和 AbortController 超时；
- 401/403、404、429、5xx 和超时映射为统一、可判断是否重试的错误。

Runtime 对外提供的配置摘要只说明 API Key 是否已配置，不返回 Key 内容。自动测试通过注入 Fake Fetch 验证 URL、Headers、请求体、超时和错误映射，不读取现有 Key，也不访问真实 Provider。

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

- 不读取用户当前已有的真实 API Key；Provider Runtime 当前只接受调用方显式注入的内存配置，不负责持久化；
- 尚未用真实 Provider 发起付费请求；
- 不替换现有线上聊天 Agent；
- 不改变当前图片、视频生成链路；
- 不实现 Trace 可视化和持久化，当前只提供内存 Trace Store；
- 本文档对应的 Gateway 阶段当时不接 Pi Agent Loop；后续 D1 阶段现已完成接入。
- 不把图片和视频强行包装成 Chat Completions。

## 4. 下一切片

C3.1 的 HTTP Transport 与 Provider Runtime、C3.2 的 Feature Flag 接入均已完成：

- `CREATIVE_MODEL_GATEWAY_ENABLED=true` 时，服务端在启动阶段统一组装 Chat Gateway；默认关闭，因此旧聊天不受影响；
- 文本 Chat 的首轮回复、原生 Tool Call、真实 Tool Result 和第二轮确认均通过 Gateway；
- API 响应携带对应 `traceIds`，但当前尚未提供 Trace UI；
- 多模态 Chat 暂不硬塞进只支持文本的 v0.1 契约，会继续使用旧链路；
- Topic Title 已改为本地首条消息摘要，不再保留旧模型入口。

Feature Flag 接入完成后，按独立授权执行了下述低成本真实冒烟请求。图片、视频和 Pi Agent Loop 在本次验收中继续后置。

## 5. C3 真实冒烟验收

2026-08-07 经用户明确授权，使用以下非敏感配置执行低成本验收：

- Base URL：`https://slb-v1.api.fan/v1`；
- 最终 Endpoint：`https://slb-v1.api.fan/v1/chat/completions`；
- 远端模型：`gemini-2.5-flash`；
- 未打印、复制或写入 Trace 的 API Key。

结果：

- 直接文本调用成功，Trace `trace-62a4f11c-d471-4894-a740-7e7896414d44` 状态为 `succeeded`，耗时 1620 ms，Usage 为输入 7、输出 16 tokens；为压低成本设置的 20-token 上限导致展示文本被截断，不影响协议验收；
- 开启 `CREATIVE_MODEL_GATEWAY_ENABLED=true` 后，页面真实执行“添加图片草稿节点”；
- 首轮模型返回 `add_canvas_node` Tool Call，浏览器从 1 个图片草稿增加到 2 个；
- 新节点 Prompt 为 `C3网关验收-蓝色纸船`，随后真实 Tool Result 进入第二轮模型调用并得到完成确认；
- 未点击 Generate，没有触发图片或视频生成任务。

C3 的真实 Provider、Endpoint、请求体、响应解析、Tool Call 两轮闭环和画布结果均通过验收。下一工程切片可以进入 D1 Creative Agent Runtime 接口。
