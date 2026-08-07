import type { ModelDefinition, ModelProviderDefinition } from './types.ts';

export const MOCK_PROVIDER: ModelProviderDefinition = {
    id: 'mock',
    displayName: 'Deterministic Mock Provider',
    protocols: ['mock'],
};

const CHAT_PARAMETERS: ModelDefinition['parameters'] = {
    temperature: {
        type: 'number',
        minimum: 0,
        maximum: 2,
        default: 0.7,
    },
    max_tokens: {
        type: 'number',
        minimum: 1,
        maximum: 8192,
        default: 2048,
    },
};

export const MOCK_MODELS: ModelDefinition[] = [
    {
        id: 'mock.chat.basic',
        displayName: 'Mock Chat Basic',
        providerId: MOCK_PROVIDER.id,
        protocol: 'mock',
        upstreamModel: 'mock-chat-basic',
        capabilities: ['chat'],
        inputModalities: ['text'],
        outputModalities: ['text'],
        parameters: CHAT_PARAMETERS,
    },
    {
        id: 'mock.chat.tool-use',
        displayName: 'Mock Chat Tool Use',
        providerId: MOCK_PROVIDER.id,
        protocol: 'mock',
        upstreamModel: 'mock-chat-tool-use',
        capabilities: ['chat', 'tool_calling'],
        inputModalities: ['text'],
        outputModalities: ['text'],
        parameters: CHAT_PARAMETERS,
    },
    {
        id: 'mock.chat.error',
        displayName: 'Mock Chat Error',
        providerId: MOCK_PROVIDER.id,
        protocol: 'mock',
        upstreamModel: 'mock-chat-error',
        capabilities: ['chat'],
        inputModalities: ['text'],
        outputModalities: ['text'],
        parameters: CHAT_PARAMETERS,
    },
];
