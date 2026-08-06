# Creative Canvas Agent 基线报告

> 基线日期：2026-08-06
> 基线提交：`9705b26411710d688d68e0ae93169961c13ce90a`
> 开发分支：`feature/creative-canvas-agent-v0.1`

## 1. 环境

- Node.js：`v26.5.0`
- npm：`11.17.0`
- 前端：React 19 + TypeScript + Vite 6
- 后端：Express 5，固定监听 `3001`
- 前端开发服务器：Vite 默认端口；`/api` 与 `/library` 代理到 `http://localhost:3001`
- 本地启动：`npm run dev`
- 仅启动后端：`npm run server`
- 生产构建：`npm run build`

## 2. 当前可运行状态

2026-08-06 实测：

| 检查项 | 结果 |
| --- | --- |
| `npm run build` | 通过 |
| `tsc --noEmit` | 通过 |
| 修改过的服务端 JS `node --check` | 通过 |
| `git diff --check` | 通过 |
| `GET http://127.0.0.1:3001/api/chat/sessions` | HTTP 200 |

构建存在一个非阻断警告：主前端包约 2.1 MB，超过 Vite 默认的 500 kB 提示阈值。它不影响当前基线，但后续需要代码分包。

## 3. 当前画布状态

- 节点状态仍由 React `useNodeManagement` 持有。
- 工作流保存、恢复由现有 `useWorkflow` / 自动保存链路处理。
- 连接仍以节点的 `parentIds` 表达，不是独立领域对象。
- 多个 Hook 可以直接调用 `setNodes`，目前还没有统一 Canvas Operation Runner。

## 4. 当前 Agent 创建节点链路

```text
ChatPanel
→ useChatAgent
→ POST /api/chat
→ chatAgent.sendMessage
→ startCanvasToolAgent
→ OpenAI-compatible Chat Completions（带 add_canvas_node tool schema）
→ 返回原生 tool_calls
→ 前端 onCanvasActions
→ addAgentDraftNode 创建可编辑草稿节点
→ 返回真实 nodeId
→ POST /api/chat/actions/:id/complete
→ completeCanvasAction
→ 以 role=tool + node_id 二次调用模型
→ 返回最终自然语言答复
```

当前优点：

- 工具动作来自模型的原生 `tool_calls`，不是从普通文本中提取。
- 创建节点与生成媒体已经分开。
- 第二次模型调用能收到真实 `nodeId`。

当前限制：

- 只支持 `add_canvas_node`。
- 工具在浏览器中直接修改 React State，服务端没有权威 Canvas Store。
- Pending action 只保存在服务端内存中，重启会丢失。
- 还没有 revision、operationId、幂等、撤销或统一 Trace。
- 只有配置第三方 OpenAI-compatible Base URL 时才走当前原生工具分支；Google 原生路径仍走旧 LangGraph。

## 5. 当前图片生成链路

```text
generationService.generateImage
→ POST /api/generate-image
→ server/routes/generation.js
→ 按 imageModel 选择 Provider
→ Gemini 分支调用 generateGeminiImage
→ GoogleGenAI SDK / 第三方 Gemini-native Base URL
```

聊天与图片生成目前仍是两套协议适配，这是后续统一模型中枢需要消除的问题。

## 6. 安全与回退基线

- `.env` 已被 `.gitignore` 排除。
- `library/`、模型目录、构建产物和依赖目录不会进入 Git。
- 当前代码基线和设计文档应分别提交，避免架构讨论与运行逻辑绑在一个回退点。
- 下一切片默认不调用真实图片或视频 API。

## 7. 下一切片入口

先实现 Headless Canvas Domain：

1. 领域 Schema 与 Node Registry；
2. 内存 Store；
3. `node.add`、`node.update`、`canvas.snapshot`；
4. operationId 幂等和 revision 冲突；
5. Node.js 自动测试与 CLI；
6. 暂不接 React UI。
