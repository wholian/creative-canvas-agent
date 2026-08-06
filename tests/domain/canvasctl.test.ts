import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

function runCanvasctl(args: string[]) {
    return spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/canvasctl.ts', ...args], {
        cwd: process.cwd(),
        encoding: 'utf8',
    });
}

test('canvasctl creates a project, executes an operation, and reads the resulting snapshot', () => {
    const tempDirectory = mkdtempSync(join(tmpdir(), 'creative-canvas-agent-cli-'));
    const statePath = join(tempDirectory, 'state.json');
    try {
        const created = runCanvasctl([
            'project', 'create',
            '--id', 'project-m1-test',
            '--title', 'M1 Test',
            '--state', statePath,
        ]);
        assert.equal(created.status, 0, created.stderr);
        assert.equal(JSON.parse(created.stdout).revision, 0);

        const executed = runCanvasctl([
            'op', 'execute',
            '--file', 'fixtures/ops/add-image-draft.json',
            '--state', statePath,
        ]);
        assert.equal(executed.status, 0, executed.stderr);
        const result = JSON.parse(executed.stdout);
        assert.equal(result.status, 'succeeded');
        assert.equal(result.data.nodeId, 'fixture-image-node');

        const snapshotResult = runCanvasctl([
            'project', 'snapshot',
            '--project', 'project-m1-test',
            '--state', statePath,
        ]);
        assert.equal(snapshotResult.status, 0, snapshotResult.stderr);
        const snapshot = JSON.parse(snapshotResult.stdout);
        assert.equal(snapshot.revision, 1);
        assert.equal(snapshot.nodes[0].id, 'fixture-image-node');
    } finally {
        rmSync(tempDirectory, { recursive: true, force: true });
    }
});
