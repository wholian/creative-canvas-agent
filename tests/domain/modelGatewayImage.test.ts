import assert from 'node:assert/strict';
import test from 'node:test';
import { createImageModelGatewayRuntime } from '../../server/imageModelGatewayRuntime.js';

function imageResponse(content: string) {
    return new Response(JSON.stringify({
        id: 'chatcmpl-image-test',
        choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 4, completion_tokens: 12 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

test('OpenAI-compatible Image Gateway sends the observed Chat Completions contract and extracts an artifact', async () => {
    let requestUrl = '';
    let authorization = '';
    let requestBody: Record<string, any> = {};
    const runtime = createImageModelGatewayRuntime({
        apiKey: 'sk-image-secret',
        baseUrl: 'https://gateway.example/v1',
        modelName: 'gemini-2.5-flash-image',
        timeoutMs: 1000,
    }, {
        fetchImplementation: async (input: RequestInfo | URL, init?: RequestInit) => {
            requestUrl = String(input);
            authorization = new Headers(init?.headers).get('authorization') || '';
            requestBody = JSON.parse(String(init?.body));
            return imageResponse('Here is the image:\n![image](data:image/png;base64,ZmFrZS1wbmc=)');
        },
    });

    const result = await runtime.generateImage({
        prompt: 'turn this into a red circle', aspectRatio: '1:1', resolution: '1K',
        referenceImages: [{
            sourceNodeId: 'reference-node-1',
            url: 'data:image/png;base64,cmVmZXJlbmNlLWltYWdl',
        }],
    });

    assert.equal(requestUrl, 'https://gateway.example/v1/chat/completions');
    assert.equal(authorization, 'Bearer sk-image-secret');
    assert.equal(requestBody.model, 'gemini-2.5-flash-image');
    assert.deepEqual(requestBody.modalities, ['text', 'image']);
    assert.deepEqual(requestBody.image_config, { aspect_ratio: '1:1', image_size: '1K' });
    assert.deepEqual(requestBody.messages[0].content, [
        { type: 'text', text: 'turn this into a red circle' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,cmVmZXJlbmNlLWltYWdl' } },
    ]);
    assert.equal(result.artifacts?.[0].mimeType, 'image/png');
    assert.equal(result.artifacts?.[0].base64, 'ZmFrZS1wbmc=');
    assert.equal(result.artifacts?.[0].byteLength, 8);
    assert.equal(result.message.content, 'Here is the image:');

    const traceJson = JSON.stringify(runtime.traceStore.list());
    assert.doesNotMatch(traceJson, /sk-image-secret|ZmFrZS1wbmc=|cmVmZXJlbmNlLWltYWdl/);
    assert.match(traceJson, /MEDIA_DATA_REDACTED/);
});

test('Image Gateway rejects unsupported parameters before sending a paid request', async () => {
    let fetchCount = 0;
    const runtime = createImageModelGatewayRuntime({
        apiKey: 'unused', baseUrl: 'https://gateway.example/v1',
        modelName: 'gemini-2.5-flash-image', timeoutMs: 1000,
    }, {
        fetchImplementation: async () => {
            fetchCount += 1;
            return imageResponse('unused');
        },
    });

    await assert.rejects(
        runtime.generateImage({ prompt: 'test', aspectRatio: '7:5', resolution: '1K' }),
        /must be one of/,
    );
    assert.equal(fetchCount, 0);
});

test('Image Gateway fails explicitly when the provider returns text without an image', async () => {
    const runtime = createImageModelGatewayRuntime({
        apiKey: 'unused', baseUrl: 'https://gateway.example/v1',
        modelName: 'gemini-2.5-flash-image', timeoutMs: 1000,
    }, { fetchImplementation: async () => imageResponse('No image available.') });

    await assert.rejects(
        runtime.generateImage({ prompt: 'test', aspectRatio: '1:1', resolution: '1K' }),
        /returned no Base64 image/,
    );
});
