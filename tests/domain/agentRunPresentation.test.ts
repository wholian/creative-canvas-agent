import assert from 'node:assert/strict';
import test from 'node:test';
import { describeAgentEvent, describeAgentTurn } from '../../src/agent-runtime/runPresentation.ts';
import type { AgentTurn } from '../../src/agent-runtime/types.ts';

function turn(overrides: Partial<AgentTurn> = {}): AgentTurn {
    return {
        id: 'turn-1', sessionId: 'session-1', status: 'running', toolRound: 0,
        traceIds: [], events: [], ...overrides,
    };
}

test('run presentation explains startup, tools and approval in product language', () => {
    assert.equal(describeAgentTurn(null, true), '正在启动 Agent…');
    assert.equal(describeAgentTurn(turn({
        status: 'awaiting_tool',
        events: [{ id: 'event-1', type: 'tool.requested', timestamp: '2026-08-09T00:00:00.000Z', toolName: 'get_canvas_snapshot' }],
    })), '正在读取画布…');
    assert.equal(describeAgentTurn(turn({ status: 'awaiting_approval' })), '等待你确认…');
    assert.equal(describeAgentEvent({
        id: 'event-2', type: 'tool.completed', timestamp: '2026-08-09T00:00:01.000Z',
        toolName: 'update_canvas_node', outcome: 'succeeded',
    }), '修改节点完成');
});
