export interface CanvasSpaceKeyEventLike {
    code?: string;
    key?: string;
    targetTagName?: string;
    targetIsContentEditable?: boolean;
}

const INTERACTIVE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A']);

export function shouldActivateCanvasSpacePan(event: CanvasSpaceKeyEventLike): boolean {
    const isSpace = event.code === 'Space' || event.key === ' ';
    if (!isSpace || event.targetIsContentEditable) return false;
    return !INTERACTIVE_TAGS.has((event.targetTagName || '').toUpperCase());
}
