# Creative Canvas Agent 实施计划

> 状态：Draft，待确认后执行
> 日期：2026-08-06
> 上位文档：[Creative Canvas Agent v0.1 Spec](./CANVAS_AGENT_V0_1_SPEC.md)

## 1. 推进原则

采用“旧系统持续可用、新内核逐步替换”的绞杀式重构，不做大爆炸重写。

每个开发切片必须满足：

1. 只引入一个主要能力或改变一个系统边界。
2. 先完成 Headless 测试，再接 React UI。
3. 默认使用内存 Store、Fake Agent 和 Mock Model Gateway。
4. 不调用真实图片或视频模型，除非当前切片明确要求并获得授权。
5. 新旧数据必须兼容，无法兼容时必须提供迁移器和恢复方式。
6. 一个切片未通过验收，不开始依赖它的下一个切片。
7. 旧实现只在新实现通过相同验收后删除。
8. 每个切片结束时交付：代码、测试结果、已知限制和下一切片入口。

## 2. 第一阶段产品边界

首个纵向里程碑 M1 只证明：

```text
用户输入自然语言
→ Pi Agent 读取 Canvas Snapshot
→ 调用原生 Canvas Tool
→ Canvas Operation Runner 执行
→ 返回真实节点或连接 ID
→ Pi Agent 收到 Tool Result
→ UI 显示最终结果
```

M1 支持：

- 读取画布；
- 创建 Text、Image Draft、Video Draft 节点；
- 更新节点标题、Prompt、位置和生成参数；
- 删除草稿节点；
- 连接和断开节点；
- CLI 触发相同操作；
- Undo / Redo；
- 完整 Agent、Tool 与 Operation Trace。

M1 不支持：

- 真实图片生成；
- 真实视频生成；
- Storyboard 重构；
- 多 Agent；
- 分支、合并和长期创作记忆；
- 远程插件。

## 3. 质量门槛

### 3.1 每个切片的 Definition of Done

一个切片只有同时满足以下条件才算完成：

- 新增行为有自动测试；
- 相关旧测试仍通过；
- TypeScript 类型检查通过；
- 构建通过；
- 默认测试不使用真实 API Key；
- 不修改真实用户项目或媒体；
- 错误返回结构化原因；
- 文档与实际接口一致；
- 能说明如何关闭或回退该切片；
- 用户可以通过一个具体操作验证结果。

### 3.2 测试层级

```text
领域单元测试
    ↓
Headless Runner 集成测试
    ↓
HTTP 契约测试
    ↓
浏览器端到端测试
    ↓
可选真实模型冒烟测试
```

原则：下层失败时不运行依赖它的上层测试。

### 3.3 安全默认值

- 测试 Store 默认使用内存或独立临时目录。
- 测试 Agent 默认使用 `FakeCreativeAgentRuntime`。
- 测试模型默认使用 `MockModelGateway`。
- 真实模型测试需要显式开关和预算确认。
- 旧工作流迁移前保留原始输入，不覆盖源文件。
- 新链路在稳定前通过 Feature Flag 开启。

## 4. 里程碑与切片

## M0：冻结基线

目标：知道重构前什么能工作，防止后续“改好了架构但弄坏原功能”。

### Slice M0.1：工作区审计

工作：

- 记录当前未提交修改；
- 列出当前前后端启动方式；
- 记录 Node 版本、依赖和端口；
- 标注当前聊天、生图、视频的调用入口；
- 不修改业务代码。

验收：

- 形成基线报告；
- 能启动现有 TwitCanva；
- 能定位当前 Agent 创建节点链路。

### Slice M0.2：最小回归用例

工作：

- 建立一个不包含密钥的旧工作流 Fixture；
- 增加当前工作流读取测试；
- 增加现有 `add_canvas_node` 浏览器冒烟测试；
- 保存预期节点数量、位置、参数和连线。

验收：

- 一条命令运行基线测试；
- 测试失败能指出具体差异。

回退：只新增测试和 Fixture，不触碰运行逻辑。

## M1-A：Headless Canvas Domain

目标：先让画布操作脱离 React，可从测试和 CLI 执行。

### Slice A1：领域类型与 Schema

工作：

- 定义 `CanvasProject`、`CanvasNode`、`CanvasConnection`；
- 定义 Text、Image、Video Payload；
- 定义 Node Registry；
- 暂不接现有 UI。

测试：

- 合法对象通过；
- 缺少必填字段失败；
- 非法枚举和未知节点类型给出明确结果；
- Schema 不依赖 React、DOM 和 `window`。

验收：`npm run test:domain` 通过，现有 UI 行为不变。

### Slice A2：最小 Operation Runner

工作：

- 实现内存 Store；
- 实现 `node.add`、`node.update`、`getSnapshot`；
- 返回真实 Node ID 和 Project revision。

测试：

- 创建节点；
- 只更新指定字段；
- 节点不存在；
- revision 冲突；
- operationId 幂等。

CLI 验证：

```bash
npm run canvasctl -- project create --title "M1 Test"
npm run canvasctl -- op execute --file fixtures/ops/add-image-draft.json
```

### Slice A3：完整基础 Ops

工作：

- `node.delete`；
- `connection.add`；
- `connection.delete`；
- 节点删除时连接级联；
- Operation Batch。

测试：

- 不存在端点不能连接；
- 重复连接幂等；
- 批量原子失败；
- 删除节点不会留下悬空连接。

### Slice A4：旧工作流迁移

工作：

- 将旧 `NodeData` 转为新节点；
- 将 `parentIds` 转为 Connection；
- 保留旧 ID、位置、Prompt、模型参数和结果 URL；
- 输出迁移警告。

测试：

- Fixture 迁移后视觉关系等价；
- 未识别字段产生警告；
- 迁移器不修改原始输入；
- 迁移结果可重复、确定。

M1-A 出口门槛：全部核心 Ops 能在没有浏览器的 Node.js 环境运行。

## M1-B：现有 UI 接入新内核

目标：保持现有画布外观和交互，把状态修改逐项切换到 Operation Runner。

### Slice B1：只读 Adapter

工作：

- 新 Store 读取现有节点；
- 新旧状态并行计算差异；
- 不改变 UI 写入路径；
- 开发模式显示状态差异。

验收：打开旧工作流时，新旧 Snapshot 等价。

### Slice B2：新增与更新节点

工作：

- 手动新增节点改走 `node.add`；
- Prompt、模型、比例和质量修改改走 `node.update`；
- 保留 Legacy Feature Flag。

测试：

- 手动操作和 CLI 产生等价节点；
- Undo / Redo；
- 刷新恢复；
- Feature Flag 关闭后旧链路仍可运行。

### Slice B3：删除与连线

工作：

- 删除和连接改走 Operation Runner；
- 清理 `parentIds` 的运行时写入；
- 旧数据仍通过迁移器读取。

测试：

- 拖拽连线；
- 删除连接；
- 删除节点级联；
- 多节点选择不受影响。

M1-B 出口门槛：人工画布操作全部通过统一 Ops，UI 没有明显回归。

## M1-C：统一模型中枢基础

目标：在接 Pi 之前，先建立可观察、可替换的模型入口。

### Slice C1：Model Registry

工作：

- 定义稳定 `modelId`；
- 定义 Provider、协议、远端模型名和参数 Schema；
- 前端不再自行拼接 Base URL 后缀。

测试：

- 模型能力查询；
- 非法参数拒绝；
- 用户选择不会被静默替换。

### Slice C2：Mock Gateway 与 Trace

工作：

- 实现 `MockModelGateway`；
- 建立 Trace 数据结构；
- 记录 messages、tools、tool call、tool result；
- 脱敏 API Key 和 Authorization。

测试：

- 成功、超时、401、404、429；
- Trace 完整；
- 凭据不出现在 Trace。

### Slice C3：一个 OpenAI-compatible Chat Adapter

工作：

- 只迁移 Chat/Tool Calling；
- 支持第三方 Base URL；
- 暂不迁移图片和视频。

验收：用一个低成本真实请求验证模型、endpoint、请求体和 Trace 一致。

真实请求必须单独授权；其余测试继续使用 Mock。

## M1-D：Pi Creative Agent Runtime

目标：用 Pi 驱动我们自己的单 Agent Loop，不依赖 Codex、Claude 或 Pi CLI。

### Slice D1：项目 Runtime 接口

工作：

- 定义 `CreativeAgentRuntime`；
- 定义稳定 Agent Event；
- 实现 `FakeCreativeAgentRuntime`；
- 不安装 Pi。

测试：

- 事件顺序；
- Abort；
- Fake Tool Call；
- Fake Tool Result；
- 前端和契约测试不需要真实模型。

### Slice D2：Pi Adapter 最小循环

工作：

- 锁定安装 `@earendil-works/pi-agent-core` 和 `@earendil-works/pi-ai`；
- 实现 `PiCreativeAgentRuntime`；
- 使用 Fake stream function；
- 转换 Pi Message 和 Event，不泄漏 Pi 类型。

测试：

- 文本响应；
- 一次工具调用；
- 工具结果后的第二轮模型响应；
- 最大轮数停止；
- 工具异常进入模型上下文。

### Slice D3：只读画布工具

工作：

- 注册 `get_canvas_snapshot`；
- `transformContext` 注入当前 revision；
- 过滤大型媒体和无关 UI 状态。

测试：

- Agent 看到当前节点和连接；
- 不携带 Base64 大文件；
- Snapshot 更新后不使用旧 revision。

### Slice D4：第一个写工具

工作：

- 注册 `add_canvas_node`；
- Pi Tool Execute 调用 Operation Runner；
- Tool Result 返回真实 Node ID；
- UI 显示 Agent 实际完成结果。

端到端验收：

```text
用户：添加一个 16:9 的森林图片草稿节点
→ 模型返回原生 tool call
→ 画布出现草稿节点
→ Tool Result 包含真实 nodeId
→ 第二次模型调用确认实际完成
```

### Slice D5：其余画布工具

按以下顺序一次只增加一个工具：

1. `update_canvas_node`
2. `connect_canvas_nodes`
3. `disconnect_canvas_nodes`
4. `delete_canvas_node`

每增加一个工具，都必须增加领域、契约和浏览器测试后才能继续。

M1-D 出口门槛：M1 的草稿节点闭环全部通过，Legacy Agent 仍能通过 Feature Flag 恢复。

## M2：生成任务与中间产物

M1 稳定后才开始。

### Slice E1：GenerationJob 状态机，纯 Mock

- 创建任务但不调用模型；
- awaiting_approval → queued → running → succeeded / failed；
- 创建 Artifact；
- 取消与有限重试。

### Slice E2：人工审批

- Agent 创建 Draft；
- UI 展示模型、参数和预计成本；
- 用户确认后提交；
- 删除和重新生成遵守审批策略。

### Slice E3：真实图片 Adapter

- 只接一个图片模型；
- 一个节点生成一张图片；
- 失败不覆盖旧 Artifact；
- Trace 与 Job 对齐。

### Slice E4：真实视频 Adapter

- 只接一个视频模型；
- 图片依赖成功后才能提交；
- 异步轮询、取消和失败展示；
- 禁止自动无限重试。

M2 出口门槛：一个图片和一个视频任务可控地跑通，用户始终能判断中间产物。

## 5. 每次交付报告格式

每个 Slice 完成后固定报告：

```text
本次实现：
未实现：
修改文件：
自动测试：
手动验证入口：
真实模型费用：
已知问题：
如何回退：
下一 Slice：
```

不得用“基本完成”“应该可用”代替测试结果。

## 6. 第一周建议节奏

在完整开发日的情况下：

| 天 | 目标 | 当天必须可验证的结果 |
| --- | --- | --- |
| Day 1 | M0 + A1 | 基线测试、领域 Schema |
| Day 2 | A2 | CLI 创建和更新节点 |
| Day 3 | A3 + A4 | 完整基础 Ops、旧工作流迁移 |
| Day 4 | B1 + B2 | UI 新增与更新走统一 Ops |
| Day 5 | B3 | UI 删除、连线、Undo/Redo 通过 |

第二周再进入 Model Gateway 与 Pi Runtime。若第一周任一出口门槛未通过，不提前接 Pi。

## 7. 当前下一步

从 Slice M0.1 开始，只做工作区基线审计，不修改运行代码。审计完成并确认基线后，再进入 M0.2。
