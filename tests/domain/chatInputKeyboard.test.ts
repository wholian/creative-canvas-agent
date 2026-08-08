import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldSubmitChatMessage } from '../../src/utils/chatInputKeyboard.ts';

test('plain Enter submits a chat message', () => {
    assert.equal(shouldSubmitChatMessage({ key: 'Enter', shiftKey: false }), true);
});

test('Shift+Enter remains a newline', () => {
    assert.equal(shouldSubmitChatMessage({ key: 'Enter', shiftKey: true }), false);
});

test('Enter confirming IME composition never submits', () => {
    assert.equal(shouldSubmitChatMessage({
        key: 'Enter', shiftKey: false, nativeIsComposing: true,
    }), false);
    assert.equal(shouldSubmitChatMessage({
        key: 'Enter', shiftKey: false, compositionActive: true,
    }), false);
    assert.equal(shouldSubmitChatMessage({
        key: 'Enter', shiftKey: false, keyCode: 229,
    }), false);
});
