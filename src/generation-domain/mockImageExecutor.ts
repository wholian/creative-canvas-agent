import type { GenerationExecutor } from './types.ts';

export interface MockImageExecutorOptions {
    delayMs?: number;
    resultUrl?: string;
}

export function createMockImageExecutor({
    delayMs = 700,
    resultUrl = '/mock-generation-artifact.svg',
}: MockImageExecutorOptions = {}): GenerationExecutor {
    return async () => {
        if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
        return { url: resultUrl, mimeType: 'image/svg+xml' };
    };
}
