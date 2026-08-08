import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldActivateCanvasSpacePan } from '../../src/utils/canvasPanKeyboard.ts';

test('Space activates temporary canvas pan outside interactive controls', () => {
    assert.equal(shouldActivateCanvasSpacePan({ code: 'Space', targetTagName: 'DIV' }), true);
    assert.equal(shouldActivateCanvasSpacePan({ key: ' ', targetTagName: 'CANVAS' }), true);
    assert.equal(shouldActivateCanvasSpacePan({ code: 'Enter', targetTagName: 'DIV' }), false);
});

test('Space remains available to text fields and interactive controls', () => {
    for (const targetTagName of ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A']) {
        assert.equal(shouldActivateCanvasSpacePan({ code: 'Space', targetTagName }), false);
    }
    assert.equal(shouldActivateCanvasSpacePan({ code: 'Space', targetTagName: 'DIV', targetIsContentEditable: true }), false);
});
