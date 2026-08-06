import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import {
    CanvasOperationRunner,
    createCanvasProject,
    InMemoryCanvasProjectStore,
    type CanvasOperation,
    type CanvasProject,
} from '../src/canvas-domain/index.ts';

interface CliState {
    projects: CanvasProject[];
}

function option(args: string[], name: string): string | undefined {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
}

function requiredOption(args: string[], name: string): string {
    const value = option(args, name);
    if (!value) throw new Error(`Missing required option: ${name}`);
    return value;
}

async function readState(path: string): Promise<CliState> {
    try {
        return JSON.parse(await readFile(path, 'utf8')) as CliState;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { projects: [] };
        throw error;
    }
}

async function writeState(path: string, state: CliState): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const [resource, command] = args;
    const statePath = resolve(option(args, '--state') || '.creative-canvas-agent/canvasctl-state.json');
    const state = await readState(statePath);
    const store = new InMemoryCanvasProjectStore(state.projects);
    const runner = new CanvasOperationRunner({ store });

    if (resource === 'project' && command === 'create') {
        const id = option(args, '--id') || crypto.randomUUID();
        if (await store.get(id)) throw new Error(`Project already exists: ${id}`);
        const project = createCanvasProject({ id, title: requiredOption(args, '--title') });
        await store.save(project);
        state.projects.push(project);
        await writeState(statePath, state);
        process.stdout.write(`${JSON.stringify(project, null, 2)}\n`);
        return;
    }

    if (resource === 'project' && command === 'snapshot') {
        const snapshot = await runner.getSnapshot(requiredOption(args, '--project'));
        process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
        return;
    }

    if (resource === 'op' && command === 'execute') {
        const operation = JSON.parse(await readFile(resolve(requiredOption(args, '--file')), 'utf8')) as CanvasOperation;
        const result = await runner.execute(operation);
        const updated = await store.get(operation.projectId);
        if (updated) {
            const index = state.projects.findIndex(project => project.id === updated.id);
            if (index >= 0) state.projects[index] = updated;
            else state.projects.push(updated);
            await writeState(statePath, state);
        }
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        if (result.status !== 'succeeded') process.exitCode = 1;
        return;
    }

    throw new Error('Usage: canvasctl project create|snapshot ... OR canvasctl op execute --file <operation.json>');
}

main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
});
