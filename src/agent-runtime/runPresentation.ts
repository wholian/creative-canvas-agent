import type { AgentTurn, AgentTurnEvent } from './types.ts';

const TOOL_LABELS: Record<string, string> = {
    get_canvas_snapshot: '读取画布',
    add_canvas_node: '创建节点',
    update_canvas_node: '修改节点',
    delete_canvas_node: '删除节点',
    connect_canvas_nodes: '连接节点',
    disconnect_canvas_nodes: '断开连接',
    request_image_generation: '生成图片',
};

function toolLabel(toolName?: string): string {
    if (!toolName) return '执行工具';
    return TOOL_LABELS[toolName] || toolName;
}

export function describeAgentTurn(turn: AgentTurn | null, isActive = false): string {
    if (!turn) return isActive ? '正在启动 Agent…' : '';
    if (turn.status === 'awaiting_approval') return '等待你确认…';
    if (turn.status === 'awaiting_tool') return `正在${toolLabel(turn.events.at(-1)?.toolName)}…`;
    if (turn.status === 'running') return '正在思考下一步…';
    if (turn.status === 'cancelled') return '本轮已停止';
    if (turn.status === 'failed') return '本轮运行失败';
    return '本轮已完成';
}

export function describeAgentEvent(event: AgentTurnEvent): string {
    if (event.type === 'turn.started') return '开始处理你的请求';
    if (event.type === 'model.started') return `模型开始思考${event.modelRound ? ` · 第 ${event.modelRound} 轮` : ''}`;
    if (event.type === 'model.completed') return '模型完成本轮判断';
    if (event.type === 'tool.requested') return `请求${toolLabel(event.toolName)}`;
    if (event.type === 'tool.completed') return `${toolLabel(event.toolName)}${event.outcome === 'succeeded' ? '完成' : '失败'}`;
    if (event.type === 'approval.requested') return `等待确认${event.toolName ? ` · ${toolLabel(event.toolName)}` : ''}`;
    if (event.type === 'approval.resolved') return event.outcome === 'approved' ? '你已批准执行' : '你已拒绝执行';
    if (event.type === 'turn.completed') return '本轮完成';
    if (event.type === 'turn.failed') return '本轮失败';
    return '你已停止本轮';
}
