# Creative Canvas Agent v0.1 Spec

> 状态：Draft，供讨论，不代表所有条目均已确认
> 创建日期：2026-08-06
> 目标仓库：creative-canvas-agent（基于 TwitCanva）
> 相关决策记录：[CREATIVE_CANVAS_AGENT_ARCHITECTURE.md](../CREATIVE_CANVAS_AGENT_ARCHITECTURE.md)
> 实施路线：[CANVAS_AGENT_IMPLEMENTATION_PLAN.md](./CANVAS_AGENT_IMPLEMENTATION_PLAN.md)

## 0. 文档规则

本 Spec 使用以下要求等级：

- **MUST**：v0.1 的必要条件，不满足则不能通过验收。
- **SHOULD**：强烈建议实现；若暂不实现，必须记录原因。
- **MAY**：允许实现，但不属于 v0.1 验收范围。
- **待确认**：尚未形成产品决策，不应在实现中悄悄固化。

本文件把内容分为三种状态：

| 状态 | 含义 |
| --- | --- |
| 已确认 | 来自前期实际体验与明确讨论，可以作为实现约束 |
| v0.1 提案 | 为了形成可执行版本而提出，实施前需确认 |
| 待确认 | 会显著影响产品或架构，当前不作决定 |

## 1. 背景与问题

目标产品不是单次生成工具，也不是全自动视频流水线，而是一个允许创作者持续查看、修改、比较和确认中间产物的“画布 + 创作 Agent”。

现有 TwitCanva 已经具有画布、图片与视频节点、连线、生成调用、工作流保存和对话 Agent，可作为实现基础。但当前存在以下结构性问题：

1. `NodeData` 同时包含通用字段、图片参数、视频参数、编辑器状态和 Storyboard 数据，节点类型边界不清晰。
2. 连线以 `parentIds` 嵌在节点内部，节点与连接没有独立生命周期。
3. 用户操作、Agent 操作和工作流恢复没有统一的操作协议。
4. Agent 当前只支持创建图片或视频节点，不能可靠读取、更新、连接或运行已有节点。
5. 聊天、图片生成和视频生成使用不同模型调用路径，配置、协议、日志和错误处理不一致。
6. 模型请求难以统一追踪，无法稳定回答“模型收到了什么、调用了哪个地址、返回了什么”。

## 2. 已确认的方向

以下方向已经明确：

1. 产品形态是“画布 + 创作 Agent”。
2. 以 TwitCanva 为实现基础，保留已有画布交互和生成能力。
3. 借鉴 infinite-canvas 的领域分层、显式连接和 Agent 操作协议思想，但独立实现，不复制其 AGPL-3.0 代码。
4. 必须建设统一的 LLM / 模型调用中枢，页面和 Agent 不得各自拼装供应商协议。
5. Agent 的画布动作必须来自模型的原生 tool call，不能依赖从普通文本中猜测或正则提取动作。
6. 工具执行结果必须返回真实结果，例如创建节点后返回实际 `nodeId`；“accepted”不能冒充执行成功。
7. 工具执行结果必须作为 `role=tool` 消息进入后续模型调用。
8. 创作者必须能看到并判断中间产物。创建节点与执行昂贵生成任务是两种不同操作。
9. 图片和视频模型的参数必须区分必填、选填与合法枚举；不得由某个页面静默覆盖用户选择。
10. ComfyUI 不作为产品主画布或核心架构参考。
11. v0.1 使用单 Agent，并基于 `@earendil-works/pi-agent-core` 实现自己的 Creative Agent Runtime。
12. 使用 `@earendil-works/pi-ai` 作为模型 Provider 基础层，但统一模型中枢仍由本项目定义和控制。
13. Pi 必须位于项目自有接口之后，Canvas Domain 与业务代码不得直接依赖 Pi 类型。
14. 不依赖 Codex 或 Claude CLI 运行产品 Agent；二者未来只能作为可选 Adapter。

## 3. v0.1 目标

v0.1 要证明下面这条闭环可以可靠运行：

```text
用户查看当前画布
→ 用自然语言提出修改
→ LLM 返回原生工具调用
→ 系统校验并执行统一 Canvas Operation
→ 返回真实节点、连接或任务结果
→ LLM 接收 role=tool 结果并回复
→ 用户在画布上检查中间产物
```

v0.1 MUST 达到：

- 手动操作和 Agent 操作使用同一个画布领域层。
- 节点、连接、项目、生成任务拥有独立且稳定的数据结构。
- Agent 能读取画布，创建、更新、删除和连接节点。
- Agent 能请求生成，但生成是否立即运行遵守审批规则。
- 所有模型调用经统一中枢，并可查看完整 Trace。
- 老版本 TwitCanva 工作流可迁移或兼容读取。
- 操作失败不会静默覆盖画布，也不会伪装成成功。

## 4. v0.1 非目标

以下内容不属于 v0.1：

- 多 Agent 分工与 Agent 间 Handoff。
- 自动生成完整短片或自动循环重试到“合格”。
- 多人实时协作。
- 通用第三方插件市场。
- 复杂时间线编辑器。
- 用户级长期审美偏好或跨项目记忆。
- 分支、合并和完整版本图。
- 云端规模化任务调度。
- 对 ComfyUI 节点图的兼容。

## 5. 总体架构

v0.1 提议采用六层结构：

```text
React UI
  ├─ Canvas View
  ├─ Node Panels
  └─ Agent Chat
        ↓
Canvas Application Layer
  ├─ dispatch(operation)
  ├─ query(snapshot)
  └─ undo / redo
        ↓
Canvas Domain
  ├─ Project
  ├─ Node
  ├─ Connection
  ├─ Artifact
  └─ Generation Job
        ↓
Agent Bridge
  ├─ Tool Schemas
  ├─ Validation
  ├─ Authorization / Approval
  └─ Tool Results
        ↓
Creative Agent Runtime
  ├─ Pi Agent Core Adapter
  ├─ Context Transform
  ├─ Tool Loop / Stop Policy
  └─ Agent Event Stream
        ↓
Unified Model Gateway
  ├─ Model Registry
  ├─ Provider Adapters
  ├─ Trace / Cost / Errors
  └─ Chat + Image + Video
        ↓
Providers / Local Runtimes
```

### 5.1 依赖方向

- UI MAY 订阅领域状态，但 MUST NOT 直接改写节点数组。
- Agent MUST 通过 Canvas Operation 修改画布。
- UI 与 Agent Bridge MUST 依赖 `CreativeAgentRuntime`，不得直接依赖 Pi Agent Core。
- Pi Tool 的 `execute()` MUST 调用 Canvas Operation Runner，不得直接改写 React State。
- 生成执行器 MUST 通过统一模型中枢调用供应商。
- 供应商 SDK 类型 MUST NOT 泄漏到 Canvas Domain。
- 领域层 MUST NOT 依赖 React 组件。

### 5.2 Agent Runtime 技术选择

v0.1 采用以下官方包：

```text
@earendil-works/pi-agent-core
@earendil-works/pi-ai
```

要求：

- 安装时 MUST 使用 lockfile 固定经过测试的精确版本，不使用浮动 latest 部署。
- 当前包要求 Node.js 22.19 或更高版本；项目运行时和 CI MUST 满足该要求。
- MUST NOT 新增 `@mariozechner/pi-agent-core` 或 `@mariozechner/pi-ai`，它们已经停止作为当前包名维护。
- MUST NOT 依赖 `pi-coding-agent`，避免引入与创作画布无关的文件、Shell 和编码 Agent 行为。
- Pi Agent Core MUST 作为库在进程内运行，不通过启动 Pi CLI 子进程实现核心产品功能。

Pi 的职责仅限于：

- Agent Loop；
- LLM 流式消息；
- Tool 参数校验与执行调度；
- Tool Result 回传；
- Agent 事件；
- Abort、Steering 与 Follow-up；
- 上下文转换、停止钩子与工具前后钩子。

Pi 不负责：

- 画布状态真实性；
- Canvas Operation 的事务、revision 和幂等；
- 人工审批规则；
- Artifact 与 GenerationJob；
- 模型配置、Trace、成本和凭据管理；
- 项目持久化和旧数据迁移。

### 5.3 CreativeAgentRuntime 接口

项目 MUST 用自己的接口封装 Pi：

```ts
interface CreativeAgentRuntime {
  start(input: AgentTurnInput): AsyncIterable<CreativeAgentEvent>;
  steer(message: AgentUserMessage): Promise<void>;
  followUp(message: AgentUserMessage): Promise<void>;
  abort(): Promise<void>;
  waitForIdle(): Promise<void>;
  getState(): CreativeAgentState;
}
```

该接口的类型属于本项目。Pi 的 `AgentMessage`、`AgentEvent`、`AgentTool` 和 Model 类型只能出现在 Adapter 内部。

第一版实现命名建议：

```text
PiCreativeAgentRuntime implements CreativeAgentRuntime
```

测试实现：

```text
FakeCreativeAgentRuntime implements CreativeAgentRuntime
```

这样领域测试、HTTP 契约测试和浏览器测试无需真实模型即可执行。

## 6. 领域模型

### 6.1 CanvasProject

```ts
interface CanvasProject {
  schemaVersion: 2;
  id: string;
  title: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  nodes: CanvasNode[];
  connections: CanvasConnection[];
  viewport: Viewport;
}
```

约束：

- `revision` MUST 在每次成功的持久化领域操作后递增。
- `schemaVersion` MUST 用于迁移旧工作流。
- 对话记录不属于画布图本身，MUST 通过 `projectId` 与项目关联。

### 6.2 CanvasNode

```ts
type CanvasNodeType =
  | "text"
  | "image"
  | "video"
  | "storyboard"
  | "group";

interface CanvasNode<TPayload = unknown> {
  id: string;
  type: CanvasNodeType | string;
  typeVersion: number;
  title: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  status: "idle" | "queued" | "running" | "succeeded" | "failed";
  locked?: boolean;
  payload: TPayload;
  artifactIds: string[];
  createdAt: string;
  updatedAt: string;
}
```

约束：

- 通用字段 MUST 与节点专属 `payload` 分离。
- `payload` MUST 由对应 Node Definition 的 Schema 校验。
- 节点不得通过 `parentIds` 持有连线；连接必须是独立实体。
- 未识别的节点类型 SHOULD 以只读占位节点显示，而不是导致项目无法打开。
- `locked=true` 时，Agent 更新 MUST 失败；是否允许用户手动更新属于待确认项。

### 6.3 节点 Payload

v0.1 提议先定义三种核心 Payload：

```ts
interface TextNodePayload {
  text: string;
}

interface ImageNodePayload {
  prompt: string;
  modelId?: string;
  aspectRatio?: string;
  quality?: string;
  referenceArtifactIds: string[];
}

interface VideoNodePayload {
  prompt: string;
  modelId?: string;
  aspectRatio?: string;
  resolution?: string;
  durationSeconds?: number;
  startFrameArtifactId?: string;
  endFrameArtifactId?: string;
  generateAudio?: boolean;
}
```

Storyboard 的具体结构尚未确认。v0.1 MAY 保留现有 Storyboard 数据，通过兼容适配器读取。

### 6.4 CanvasConnection

```ts
interface CanvasConnection {
  id: string;
  from: { nodeId: string; port?: string };
  to: { nodeId: string; port?: string };
  kind: "reference" | "sequence" | "input";
  createdAt: string;
}
```

约束：

- 连接的两端节点 MUST 存在。
- 相同端点、端口和类型的重复连接 MUST 被拒绝或幂等处理。
- 删除节点 MUST 同步删除关联连接。
- v0.1 UI MAY 不展示端口类型，但数据模型 SHOULD 预留端口。

### 6.5 Artifact

Artifact 表示生成或上传得到的不可变产物，而不是节点本身。

```ts
interface Artifact {
  id: string;
  projectId: string;
  kind: "image" | "video" | "audio" | "text";
  url: string;
  mimeType?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  sourceJobId?: string;
  createdAt: string;
}
```

约束：

- 重新生成 MUST 新建 Artifact，不得覆盖旧文件记录。
- 节点通过 `artifactIds` 引用产物。
- 当前展示哪个 Artifact MAY 暂存在节点 Payload 中，最终字段名待确认。

### 6.6 GenerationJob

```ts
interface GenerationJob {
  id: string;
  projectId: string;
  nodeId: string;
  mode: "image" | "video" | "audio" | "text";
  status: "awaiting_approval" | "queued" | "running" | "succeeded" | "failed" | "cancelled";
  modelId: string;
  normalizedInput: Record<string, unknown>;
  providerRequestId?: string;
  outputArtifactIds: string[];
  error?: StructuredError;
  createdAt: string;
  updatedAt: string;
}
```

创建节点 MUST NOT 自动创建或运行 GenerationJob。

## 7. Node Definition Registry

节点类型不应通过散落在组件中的 `switch` 无限扩张。每种节点 SHOULD 通过注册表声明：

```ts
interface NodeDefinition<TPayload> {
  type: string;
  version: number;
  title: string;
  defaultSize: { width: number; height: number };
  defaultPayload: () => TPayload;
  validatePayload: (input: unknown) => TPayload;
  capabilities: Array<"editable" | "generatable" | "connectable">;
}
```

v0.1 MUST 支持内置节点注册；动态加载远程插件属于非目标。

## 8. Canvas Operation 协议

### 8.1 Operation Envelope

所有用户、Agent、导入器和系统触发的持久化画布修改 MUST 表达为 Canvas Operation：

```ts
interface CanvasOperation<TPayload = unknown> {
  operationId: string;
  projectId: string;
  actor: { type: "user" | "agent" | "system"; id?: string };
  baseRevision: number;
  type: CanvasOperationType;
  payload: TPayload;
  createdAt: string;
}
```

### 8.2 v0.1 Operation 类型

```ts
type CanvasOperationType =
  | "node.add"
  | "node.update"
  | "node.delete"
  | "connection.add"
  | "connection.delete"
  | "viewport.update"
  | "generation.request";
```

选择状态、Hover、菜单开关等短期 UI 状态 MUST NOT 进入持久化 Operation Log。

### 8.3 Operation Result

```ts
interface CanvasOperationResult {
  operationId: string;
  status: "succeeded" | "rejected" | "failed";
  projectRevision: number;
  affectedIds: string[];
  data?: Record<string, unknown>;
  error?: StructuredError;
}
```

执行语义：

- `operationId` MUST 幂等；同一个 ID 重放不得重复创建节点或任务。
- `baseRevision` 与当前版本不一致时，系统 MUST 返回 `revision_conflict`，不得静默覆盖。
- 每个 Operation MUST 原子执行。
- 成功创建节点 MUST 在 `affectedIds` 或 `data.nodeId` 中返回真实 ID。
- `rejected` 表示校验、权限或审批不通过；`failed` 表示执行过程发生错误。
- Operation Result MUST 可写入 Agent 的 `role=tool` 消息。

### 8.4 Headless Operation Runner

Canvas Operation MUST 能在不启动 React、不打开浏览器的情况下执行。领域层应提供唯一的无 UI 入口：

```ts
interface CanvasOperationRunner {
  execute(operation: CanvasOperation): Promise<CanvasOperationResult>;
  executeBatch(operations: CanvasOperation[], options?: {
    atomic?: boolean;
  }): Promise<CanvasOperationResult[]>;
  getSnapshot(projectId: string): Promise<CanvasProject>;
}
```

约束：

- React UI、Agent Bridge、CLI 和自动化测试 MUST 调用同一个 Runner。
- Runner MUST NOT 导入 React、DOM、`window` 或浏览器组件。
- Operation 校验、revision、幂等、锁定和级联删除 MUST 在 Runner 或其领域依赖中实现，不得只在 UI 中实现。
- Runner MUST 支持注入内存 Store，以便测试不访问真实用户项目。
- Runner MUST 支持注入 Mock Model Gateway，以便测试不产生真实模型费用。
- 真实 Store 与测试 Store MUST 通过相同接口工作。

### 8.5 CLI

v0.1 MUST 提供一个开发者 CLI，暂定命令名为 `canvasctl`。它是 Operation Runner 的薄适配器，不得复制领域逻辑。

建议命令：

```bash
npm run canvasctl -- project create --title "Test Project"
npm run canvasctl -- project snapshot --project <project-id>
npm run canvasctl -- op execute --file ./operation.json
npm run canvasctl -- op batch --file ./operations.jsonl
npm run canvasctl -- fixtures load --file ./fixtures/basic-project.json
npm run canvasctl -- verify --project <project-id>
```

CLI MUST：

- 默认使用独立的测试数据目录，不得修改用户正在使用的项目。
- 支持 `--store memory`，用于一次性自动测试。
- 支持 `--store test`，用于可重复查看的测试项目。
- 以 JSON 输出 Operation Result，方便脚本断言。
- 失败时返回非零退出码。
- 支持 `--dry-run`，只校验 Operation，不提交修改。
- 明确区分 Mock Gateway 与真实 Gateway；真实模型调用必须显式传入 `--allow-real-models`。

示例输出：

```json
{
  "operationId": "op-test-add-image-1",
  "status": "succeeded",
  "projectRevision": 2,
  "affectedIds": ["node-image-1"],
  "data": { "nodeId": "node-image-1" }
}
```

## 9. Agent 工具协议

Pi Agent Core 负责标准 Tool Loop，但不定义画布工具的业务语义。Canvas Tool 由本项目注册，并将 Pi Tool 的执行请求转换为 Canvas Operation。

### 9.1 v0.1 工具集

```text
get_canvas_snapshot
add_canvas_node
update_canvas_node
delete_canvas_node
connect_canvas_nodes
disconnect_canvas_nodes
request_generation
get_generation_status
```

其中：

- 查询工具返回当前项目的结构化 Snapshot。
- 修改工具内部编译为一个或多个 Canvas Operation。
- `request_generation` 只创建生成请求；是否执行由审批策略决定。
- 工具参数 MUST 使用 JSON Schema 声明必填项、选填项、枚举和长度限制。

当前“画布操作闭环”切片只开放前六个工具；生成相关工具继续后置：

| Tool | 作用 | 关键参数 |
| --- | --- | --- |
| `get_canvas_snapshot` | 读取当前画布的轻量结构 | 无 |
| `add_canvas_node` | 新增 Image / Video 草稿 | `node_type`、`prompt`，模型参数选填 |
| `update_canvas_node` | 修改一个既有节点 | `node_id`、`expected_snapshot_version`、`patch` |
| `delete_canvas_node` | 删除节点并级联删除关联连接 | `node_id`、`expected_snapshot_version` |
| `connect_canvas_nodes` | 建立父节点到子节点的 input 连接 | `from_node_id`、`to_node_id`、`expected_snapshot_version` |
| `disconnect_canvas_nodes` | 删除指定父子节点间的 input 连接 | `from_node_id`、`to_node_id`、`expected_snapshot_version` |

`update_canvas_node.patch` v0.1 只允许以下字段：

```text
title
prompt
x / y
model
aspect_ratio
resolution
```

不允许 Agent 通过通用 Patch 修改 `resultUrl`、生成状态、编辑器数据、历史记录或其他 UI-only 字段。

### 9.2 Snapshot 范围

Agent 每轮不应默认接收全部 Base64、完整视频或无限历史。Snapshot SHOULD 包含：

- project id、title、revision；
- 节点 id、type、title、position、status、必要 payload；
- 连接关系；
- 当前选择的节点；
- Artifact 元数据和可访问引用，不直接内嵌大文件；
- 被锁定字段；
- 最近相关操作的结果。

Snapshot 裁剪策略属于实现细节，但 MUST 保证模型基于当前 revision 工作。

当前 React 画布仍是 UI 权威状态，尚未长期持有 Domain revision。因此过渡期 Snapshot 使用确定性的 `snapshot_version`：它由 Agent 可见节点字段和显式连接排序后计算，功能等价于乐观并发版本。

Snapshot 返回：

```json
{
  "snapshot_version": "canvas-v1-...",
  "title": "Untitled",
  "nodes": [
    {
      "id": "node-id",
      "type": "image",
      "title": "AI Image Draft",
      "prompt": "...",
      "position": { "x": 100, "y": 200 },
      "status": "idle",
      "model": "gemini-pro",
      "aspect_ratio": "16:9",
      "resolution": "2K"
    }
  ],
  "connections": [
    { "from_node_id": "a", "to_node_id": "b", "kind": "input" }
  ]
}
```

Snapshot MUST NOT 返回 Base64、完整媒体、API Key、编辑器画布数据或完整 Artifact 内容。

除新增节点外，所有写工具 MUST 回传最近一次 Snapshot 的 `expected_snapshot_version`。浏览器执行前重新计算版本；不一致时返回 `stale_canvas_snapshot`，不得在旧状态上继续修改。模型收到该 Tool Result 后只能重新读取或停止。

### 9.3 标准工具循环

```text
1. 用户消息 → LLM；涉及既有画布对象时模型先调用 `get_canvas_snapshot`
2. LLM → assistant.tool_calls
3. 服务端校验 Tool Schema
4. Canvas Runtime 执行 Canvas Operation
5. Runtime → Operation Result（包含真实 ID / 错误）
6. 服务端追加 role=tool 消息
7. LLM 生成最终回复或下一轮工具调用
```

约束：

- MUST 支持一轮多个 Tool Call；同一响应中的多个写操作以一个原子 Batch 顺序执行，共用执行前的 `expected_snapshot_version`。
- 读取与写入不得混在同一 Tool Call Batch；模型必须先取得读取结果，再在下一轮提出写入。
- 有依赖的操作 MUST 跨轮串行，例如先创建节点并取得真实 ID，再使用其 ID 建立连接。
- 最大工具循环次数确认为 5；浏览器和服务端都必须限制，超过后返回结构化错误并停止。
- 模型返回普通文本中的 JSON、XML 或“动作建议”不得直接修改画布。
- Agent MUST 在最终回复中概括实际成功和失败的动作，不得只复述计划。
- 删除只在用户明确要求、且 Snapshot 能唯一定位目标节点时执行；引用不明确时必须先询问，不得猜测。
- `from_node_id → to_node_id` 定义为父节点向子节点提供 input，禁止模型反向解释。

统一 Tool Result 至少包含：

```json
{
  "toolCallId": "call-id",
  "status": "succeeded | failed",
  "operation": "snapshot | add | update | delete | connect | disconnect",
  "snapshotVersion": "canvas-v1-...",
  "nodeId": "optional-real-node-id",
  "connectionId": "optional-real-connection-id",
  "errorCode": "optional-structured-code",
  "error": "optional-readable-message"
}
```

### 9.4 Pi Agent Core 映射

Pi Agent Core 与本项目概念的映射如下：

| Pi 概念 | 本项目用途 |
| --- | --- |
| `Agent` / `agentLoop` | 驱动单 Agent 多轮工具循环 |
| `AgentTool.parameters` | 承载 Canvas Tool JSON Schema |
| `AgentTool.execute()` | 调用 Canvas Operation Runner |
| `beforeToolCall` | 接入审批、锁定和权限检查 |
| `afterToolCall` | 统一结构化 Tool Result、Trace 与停止提示 |
| `transformContext` | 注入并裁剪当前 Canvas Snapshot |
| `convertToLlm` | 过滤 UI-only 事件并生成模型消息 |
| `shouldStopAfterTurn` | 实现最大轮数、预算和产品停止条件 |
| `subscribe()` | 转换为项目自己的 Agent Event Stream |
| `abort()` | 取消当前 Agent Turn；不能冒充已取消外部生成任务 |
| `steer()` | 接收用户在运行中的方向修正 |
| `followUp()` | 当前工具链完成后的追加任务 |

规则：

- Canvas 写工具 v0.1 SHOULD 使用顺序执行，避免并行操作基于相同 revision 产生竞争。
- 纯读取工具 MAY 并行执行。
- `beforeToolCall` 拒绝执行时 MUST 返回明确原因，并进入标准 Tool Result。
- Pi 的循环终止不等于 GenerationJob 取消；外部任务必须由独立 Job API 管理。
- Agent Event MUST 转换为项目自己的稳定事件类型后再发给前端。

## 10. 人工确认与生成边界

v0.1 提议使用以下规则：

| 动作 | 默认是否需要确认 |
| --- | --- |
| 读取画布 | 否 |
| 创建草稿节点 | 否 |
| 修改未锁定草稿节点 | 否 |
| 删除节点或连接 | 是 |
| 创建图片生成任务 | 是 |
| 创建视频生成任务 | 是 |
| 提交已确认任务 | 不再次确认 |
| 自动重试生成 | 是 |

待确认：如果用户在当前消息中明确说“生成图片/视频”，是否视为本次任务的一次预授权。

无论审批策略如何，系统 MUST：

- 在运行前显示模型、关键参数和预计成本（若可得）。
- 展示 queued、running、succeeded、failed 等真实状态。
- 禁止无限重试。
- 不得在图片依赖尚未成功时静默开始依赖它的视频任务。

## 11. 统一模型调用中枢

### 11.1 职责

所有 Chat、Agent、图片、视频和评审调用 MUST 经过统一中枢。中枢负责：

- 模型注册与能力描述；
- API Key、Base URL 和协议选择；
- 请求参数归一化；
- 供应商 Adapter；
- 同步调用与异步任务；
- 超时、重试、取消和结构化错误；
- 完整请求/响应 Trace；
- 延迟、Token、成本和供应商请求 ID；
- 敏感信息脱敏。

页面和业务模块 MUST NOT 直接实例化 OpenAI、Gemini、Fal 或其他供应商 SDK。

### 11.2 Model Registry

```ts
interface ModelProfile {
  id: string;
  providerId: string;
  protocol: "openai-chat" | "openai-responses" | "gemini-native" | "custom";
  remoteModel: string;
  capabilities: Array<"chat" | "tools" | "vision" | "image" | "video" | "audio">;
  parameterSchema: Record<string, unknown>;
  defaults: Record<string, unknown>;
  enabled: boolean;
}
```

规则：

- 前端传递稳定的 `modelId`，不得自行拼 Base URL 或远端模型名。
- Registry MUST 给出合法参数与默认值。
- Adapter MUST 拒绝不支持的参数，而不是静默忽略或替换。
- 模型选择 MUST 从请求一直保留到 Trace 和 GenerationJob。

### 11.3 统一调用接口

领域接口提议为：

```ts
invokeChat(request): Promise<ChatResult>
invokeAgent(request): Promise<AgentTurnResult>
createGenerationJob(request): Promise<GenerationJob>
getGenerationJob(id): Promise<GenerationJob>
cancelGenerationJob(id): Promise<GenerationJob>
```

HTTP 路由形式和具体路径属于实现细节，不在本 Spec 中固定。

### 11.4 Trace

每次模型调用 MUST 产生 Trace：

```ts
interface ModelTrace {
  traceId: string;
  parentTraceId?: string;
  projectId?: string;
  sessionId?: string;
  operationId?: string;
  jobId?: string;
  taskType: "chat" | "agent" | "image" | "video" | "review";
  modelId: string;
  providerId: string;
  protocol: string;
  endpoint: string;
  requestBody: unknown;
  responseBody?: unknown;
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  endedAt?: string;
  latencyMs?: number;
  tokenUsage?: Record<string, number>;
  estimatedCost?: number;
  providerRequestId?: string;
  error?: StructuredError;
}
```

开发模式 MUST 能查看模型最终收到的完整消息、tools 定义、tool calls 和 tool results。

API Key、Authorization Header 和敏感凭据 MUST 脱敏。大型 Base64 资源 SHOULD 记录哈希、大小和引用，不应重复写入日志。

## 12. 错误模型

```ts
interface StructuredError {
  code: string;
  message: string;
  retryable: boolean;
  source: "validation" | "canvas" | "gateway" | "provider" | "network";
  details?: Record<string, unknown>;
}
```

v0.1 MUST 区分：

- `validation_error`
- `unknown_node`
- `unknown_connection`
- `locked_node`
- `revision_conflict`
- `approval_required`
- `unsupported_model_parameter`
- `provider_auth_error`
- `provider_rate_limit`
- `provider_model_not_found`
- `provider_timeout`
- `network_error`
- `generation_failed`

前端不得只显示 `failed`；至少显示可理解的错误原因和建议动作。

## 13. 状态与持久化

### 13.1 v0.1 提案

- 浏览器中的 Canvas Runtime 负责当前打开项目的即时交互状态。
- 服务端负责项目、Artifact、GenerationJob、Trace 和聊天会话的持久化。
- 所有持久化画布更新通过 Canvas Operation 进入领域层。
- 自动保存 SHOULD 防抖，但保存确认不得冒充 Operation 执行确认。

### 13.2 待确认

- 服务端是画布的最终 Source of Truth，还是仅保存前端快照。
- v0.1 使用 JSON 文件、SQLite 还是现有存储方式。
- Operation Log 是否在 v0.1 持久化。

推荐但未确认：v0.1 使用 SQLite 保存项目、任务和 Trace；媒体文件仍使用现有文件存储或对象存储接口。

## 14. Undo / Redo

v0.1 MUST 保留现有 Undo / Redo 体验。

提议：

- 用户和 Agent 的成功 Canvas Operation 都进入同一历史记录。
- 每个 Agent Tool Call 对应一个可识别的历史动作。
- 多个需要原子完成的 Operation MAY 组成 transaction。
- GenerationJob 的外部副作用不能通过 Undo 删除；Undo 只恢复画布引用和显示状态。

完整 Event Sourcing 不属于 v0.1。

## 15. 旧数据迁移

现有工作流必须继续可用。

迁移器 MUST：

1. 识别没有 `schemaVersion` 的旧 TwitCanva 工作流。
2. 将旧 `NodeData` 的通用字段转换为 `CanvasNode`。
3. 将图片、视频和编辑器专属字段移动到对应 Payload。
4. 将 `parentIds` 转换为独立 `CanvasConnection`。
5. 保留旧节点 ID、位置、Prompt、结果 URL 和分组信息。
6. 对无法迁移的字段生成警告，不得静默丢弃。

迁移后的项目 MUST 写入 `schemaVersion: 2`。迁移前原始数据 SHOULD 保留可恢复副本。

## 16. 安全与边界

- API Key MUST 只存在于服务端配置或安全存储，不得进入画布 JSON。
- Agent Tool Schema MUST 使用 allowlist，不允许模型传入任意函数名。
- 节点 Payload MUST 校验长度、枚举和 URL 类型。
- 远程插件执行不属于 v0.1。
- 日志查看界面 MUST 默认隐藏凭据。
- 删除、生成和外部发布等副作用 MUST 遵守审批策略。

## 17. 可观测性界面

开发模式 SHOULD 提供一个 Trace 面板，至少能查看：

- 时间线；
- 原始用户消息；
- System Prompt；
- 模型与最终 endpoint；
- 完整 tools 定义；
- 每一次 assistant tool call；
- Canvas Operation 和真实结果；
- 后续 role=tool 消息；
- 最终模型响应；
- Token、延迟、成本和错误。

该面板用于替代日常依赖 mitmproxy 阅读 AI 调用。mitmproxy 仍可作为协议级调试工具。

## 18. 验收场景

v0.1 至少通过以下测试：

1. 用户手动创建图片节点，与 Agent 创建图片节点产生相同领域对象。
2. Agent 创建节点后，第二次模型调用收到真实 `nodeId`。
3. 重放相同 `operationId` 不会产生第二个节点。
4. Agent 基于旧 revision 更新节点时得到 `revision_conflict`，现有数据不被覆盖。
5. Agent 不能更新锁定节点。
6. Agent 只修改指定节点字段，其他字段与节点保持不变。
7. 删除节点会同步删除相关连接，并产生可见确认。
8. 连接不存在的节点会返回结构化错误。
9. 创建生成节点不会自动调用图片或视频模型。
10. 用户确认生成后，任务按状态机更新并生成新的 Artifact。
11. 视频所需图片依赖未成功时，视频任务不能开始。
12. 前端选择的模型、比例和质量与 Gateway 实际请求一致。
13. 非法枚举值在调用供应商之前被拒绝。
14. Trace 能还原 system、messages、tools、tool call、tool result 和最终回复。
15. Trace 中不显示 API Key。
16. 一个旧 TwitCanva 工作流可以迁移并保持视觉位置和连线关系。
17. Agent 动作可以 Undo，且不会错误撤销已经发生的外部生成费用。
18. 供应商 401、404、429、超时和模型不存在错误能被区分显示。
19. 相同的 `node.add` Operation 分别经 UI Adapter、Agent Bridge 和 CLI 执行时，得到等价的领域结果。
20. Headless Runner 在没有 DOM、`window` 和浏览器的 Node.js 环境中可以运行完整操作集。
21. CLI 使用内存 Store 完成创建项目、添加节点、连接、更新、删除和 Snapshot 校验。
22. CLI 默认不会调用真实模型，也不会修改用户项目数据。
23. Mock Gateway 能模拟同步成功、异步成功、超时、限流、鉴权失败和模型不存在。
24. 一条自动化命令能够从空 Store 运行全部 v0.1 验收用例并返回明确退出码。

## 19. 建议的代码边界

以下目录只是 v0.1 提案，名称可调整：

```text
src/
  canvas/
    domain/
      project.ts
      node.ts
      connection.ts
      artifact.ts
      generation-job.ts
    operations/
      operation-types.ts
      operation-reducer.ts
      operation-runner.ts
      operation-validator.ts
    registry/
      node-definition.ts
      builtin-nodes.ts
    store/
      canvas-store.ts
    migration/
      legacy-workflow.ts
    agent/
      canvas-tools.ts
      canvas-snapshot.ts
      agent-bridge.ts

  cli/
    canvasctl.ts
    commands/
      project.ts
      operation.ts
      fixtures.ts
      verify.ts

  testing/
    in-memory-canvas-store.ts
    mock-model-gateway.ts
    fixtures/

server/
  agent/
    runtime/
      creative-agent-runtime.ts
      pi-creative-agent-runtime.ts
      fake-creative-agent-runtime.ts
      pi-event-adapter.ts
      pi-message-adapter.ts
    context/
      canvas-context-transform.ts
      message-converter.ts
    tools/
      canvas-agent-tools.ts
      tool-result-adapter.ts
  ai/
    gateway/
      model-registry.js
      model-gateway.js
      trace-store.js
      errors.js
    providers/
      openai-compatible.js
      gemini-native.js
      fal.js
  canvas/
    project-store.js
    operation-store.js
    artifact-store.js
    generation-job-store.js
```

现有组件和服务通过 Adapter 逐步迁移，不要求一次性移动全部代码。

## 20. 分阶段实施建议

### Phase 1：领域层，不改变 UI

- 建立 Project、Node、Connection 与 Operation 类型。
- 建立 Node Registry。
- 建立无 UI Operation Runner 和内存 Store。
- 建立 `canvasctl` 的 project、op 和 snapshot 基础命令。
- 用 Adapter 包装现有 `useNodeManagement`。
- 为旧工作流编写迁移测试。

完成标准：现有 UI 行为不变，但新增、更新、删除和连线都能通过 Operation 执行；相同操作也能从 CLI 在内存 Store 中运行。

### Phase 2：Agent Bridge

- 引入锁定版本的 Pi Agent Core 与 Pi AI。
- 建立 `CreativeAgentRuntime` 和 Pi Adapter。
- 增加画布 Snapshot。
- 扩展原生工具集。
- 返回真实 Operation Result。
- 增加 revision、幂等和锁定检查。
- 将 Pi 事件转换为项目稳定事件，不向前端暴露 Pi 类型。

完成标准：Agent 能可靠读取并局部修改已有画布。

### Phase 3：统一模型中枢

- 建立 Model Registry 和 Adapter。
- 将聊天、图片和视频调用迁入 Gateway。
- 建立 Trace Store 和开发查看界面。

完成标准：业务代码不再直接实例化供应商 SDK，并能还原每次调用。

### Phase 4：GenerationJob 与审批

- 将节点创建和生成执行彻底分开。
- 建立异步任务状态和 Artifact 记录。
- 加入人工确认、失败恢复和有限重试。

完成标准：中间产物可判断，任务状态真实，依赖未完成时不会错误推进。

## 21. 实施前待确认的问题

以下问题会改变实现，不应由开发过程默认决定：

1. v0.1 的第一批正式节点是否只包含 Text、Image、Video，Storyboard 暂走兼容层？
2. 用户在消息中明确说“生成”时，是否直接视为一次生成审批？
3. 删除单个空节点是否也需要确认，还是只有批量删除与含 Artifact 的节点需要确认？
4. 画布 Source of Truth 采用“浏览器运行时 + 服务端快照”，还是“服务端权威状态”？
5. v0.1 是否立即使用 SQLite，还是先沿用现有工作流存储并只抽象接口？
6. 是否在 v0.1 实现 `locked`，以及锁定是整个节点还是字段级？
7. Agent 每轮最多执行多少次工具循环？提议为 5。
8. Trace 是否默认保存完整 Prompt 与响应，还是仅在开发模式完整保存？

Pi Agent Core 和 Pi AI 的采用已经确认，不属于待确认项；待确认的是其上层产品策略，而不是是否使用 Pi。

## 22. Definition of Done

当且仅当以下条件同时满足，v0.1 才算完成：

- 第 18 节验收场景全部通过；
- 旧工作流可以迁移；
- UI、Agent 和导入器共享 Canvas Operation；
- Agent 工具调用与真实执行结果形成完整闭环；
- 产品 Agent Loop 由 `PiCreativeAgentRuntime` 在进程内驱动，不依赖 Codex、Claude 或 Pi CLI 子进程；
- Pi 类型没有泄漏到 Canvas Domain、HTTP 契约或前端公共类型；
- 所有模型调用进入统一 Gateway；
- 至少一个图片模型和一个视频模型通过 Gateway 跑通；
- Trace 面板能够还原调用链；
- Headless Operation Runner 和 `canvasctl` 可执行全部核心 Ops；
- 自动化测试默认使用隔离 Store 和 Mock Gateway，不访问用户项目、不产生模型费用；
- 一条命令能够运行全部 v0.1 自动化验收，并以退出码报告成功或失败；
- 没有已知路径会在未确认的情况下自动提交昂贵视频任务；
- 已确认、提案和待确认项在实现文档中保持可追踪。

## 23. 自动测试分层

实现完成后 MUST 按以下顺序自动验证：

### 23.1 领域单元测试

使用内存 Store，不启动服务器：

- Operation Schema 与 Payload 校验；
- revision 冲突；
- `operationId` 幂等；
- 锁定节点；
- 连接约束；
- 删除节点时的连接级联；
- 旧工作流迁移。

### 23.2 Headless 集成测试

启动 Operation Runner，使用 Mock Gateway：

- 完整 CRUD；
- 批量 Operation；
- Agent Tool Call 到 Operation Result；
- GenerationJob 状态机；
- Artifact 新建与引用；
- Trace 内容和凭据脱敏；
- 各类供应商错误映射。

### 23.3 HTTP 契约测试

启动测试服务器，但不启动浏览器：

- API 输入输出与 JSON Schema；
- 非法参数与 HTTP 状态码；
- Agent 暂停、Tool Result 和恢复调用；
- Job 查询和取消；
- Trace 查询。

### 23.4 浏览器端到端测试

启动前后端与浏览器，使用 Mock Gateway：

- 用户手动操作画布；
- Agent 创建和修改节点；
- 节点与连线的可视化结果；
- 审批与生成状态；
- Undo / Redo；
- 刷新后的项目恢复。

浏览器测试只负责验证 UI 接线和可见行为，不替代领域测试。

### 23.5 可选真实模型冒烟测试

真实模型测试默认关闭，只有显式授权并提供测试预算时才运行：

- 一个低成本 Chat / Tool Call；
- 一个图片生成任务；
- 一个视频生成任务可延后到人工确认；
- 验证真实模型、参数、Trace 和 Artifact 一致。

建议最终提供以下统一命令，具体脚本名可在实现时调整：

```bash
npm run test:domain
npm run test:integration
npm run test:contract
npm run test:e2e
npm run test:acceptance
```

`test:acceptance` MUST 默认不调用真实模型，并汇总前四层的结果。
