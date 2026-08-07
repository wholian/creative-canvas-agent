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

## 3. 当前明确不包含

- 不读取或保存真实 API Key；
- 不发起真实网络请求；
- 不替换现有线上聊天 Agent；
- 不改变当前图片、视频生成链路；
- 不实现 Trace 可视化；
- 不接 Pi Agent Loop；
- 不把图片和视频强行包装成 Chat Completions。

## 4. 下一切片

下一步进入 C2 Trace：为统一调用记录脱敏后的请求、模型路由、响应、Tool Call、Tool Result、耗时和错误。仍先使用 Mock 与注入式假 Transport 验证，不接真实付费 API。
