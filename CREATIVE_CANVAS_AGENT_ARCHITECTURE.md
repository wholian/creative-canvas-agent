# 画布 + 创作 Agent：决策记录（草案）

> 更新时间：2026-08-06
> 说明：本文件只记录已经明确确认的方向。其余内容只是待讨论问题，不构成产品或技术决策。

## 已确认

### 1. 最终产品形态

目标是做一个“**画布 + 创作 Agent**”的创作产品，而不只是单一的聊天框或自动化生成流水线。

### 2. 需要统一的 LLM / 模型调用中枢

这是当前已经确认的技术需求。

原因来自本次实际排查：聊天、图片生成、视频生成等场景各自使用不同 SDK、协议、Base URL、鉴权和错误处理，会导致同一个模型配置在不同位置行为不一致，也难以知道一次请求最终到底发送了什么。

这个中枢至少应集中处理：

- 模型与供应商配置；
- API Key、Base URL 与协议适配；
- 模型请求与响应的统一日志 / Trace；
- 请求参数、模型版本、耗时、错误与成本的记录；
- 让页面和 Agent 都通过同一个入口调用模型，而不是各自直连 SDK。

当前原则：**每个场景单独拼一套模型调用逻辑不可接受。**

### 3. Agent Runtime 基于 Pi Agent Core，自主实现产品 Agent

这是当前已经确认的技术方向。

采用当前官方维护的包：

- `@earendil-works/pi-agent-core`：提供 Agent Loop、工具执行和事件流；
- `@earendil-works/pi-ai`：提供多供应商模型调用基础能力。

不采用：

- 已废弃的 `@mariozechner/pi-agent-core` 与 `@mariozechner/pi-ai`；
- 面向编码任务、附带文件和 Shell 工具的 `pi-coding-agent`；
- 将 Codex 或 Claude CLI 作为产品唯一 Agent Runtime 的方案。

Pi Agent Core 在本项目中只负责：

- LLM 与 Tool Result 之间的多轮循环；
- 工具参数校验与执行调度；
- 串行或并行工具执行；
- 流式事件；
- Abort、Steering、Follow-up；
- Agent 上下文转换和停止钩子。

本项目仍然自主负责：

- Creative Agent 的 System Prompt 与行为边界；
- Canvas Snapshot 与上下文裁剪；
- Canvas Tool Schema；
- Canvas Operation Runner；
- 人工确认与权限策略；
- Project、Node、Connection、Artifact 与 GenerationJob；
- 统一模型中枢、第三方 Base URL、Trace、成本和脱敏；
- 项目持久化、迁移与自动化验收。

Pi 必须被封装在项目自有的 `CreativeAgentRuntime` 接口之后。画布、生成任务和业务组件不得直接依赖 Pi 类型，以便未来升级、替换或测试 Agent Runtime。

## 待讨论，尚未确认

以下只是后续需要一起判断的问题，暂不作为实现要求：

- 画布状态是否应由后端持久化，还是先保留在前端；
- Agent 的工具执行如何与浏览器画布状态同步；
- 是否需要版本、分支、锁定和创作决策记忆；
- 需要哪些中间产物审批点；
- 模型路由是否由系统自动选择，还是始终由用户指定；
- 是否建立模型评测集、Reviewer 和成本策略；
- 创作图、执行图、Skill 等概念是否进入第一版。

当前已确定 v0.1 先实现单 Agent Runtime；未来是否引入多 Agent 仍是独立的待讨论项，不能改变 v0.1 的基础接口。

## 当前观察（不是结论）

这次 TwitCanva 排查暴露了几个待验证问题：聊天与生图走了不同调用链；工具调用的“已接受”不等于浏览器已创建节点；不同模型接口的协议并不相同。它们说明统一调用中枢值得优先讨论，但不自动决定其余产品架构。

## 下一次讨论的起点

先定义“统一 LLM 调用中枢”的最小边界：它有哪些输入、输出、日志字段与模型配置方式；再决定画布、Agent、项目状态应该如何接入它。
