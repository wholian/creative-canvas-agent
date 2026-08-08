export interface ChatInputKeyboardState {
    key: string;
    shiftKey: boolean;
    nativeIsComposing?: boolean;
    compositionActive?: boolean;
    keyCode?: number;
}

/**
 * Enter submits only when it is an intentional chat submission. IME engines
 * also emit Enter while confirming Chinese/Japanese/Korean composition; that
 * event must remain inside the textarea instead of sending a partial message.
 */
export function shouldSubmitChatMessage(event: ChatInputKeyboardState): boolean {
    return event.key === 'Enter'
        && !event.shiftKey
        && !event.nativeIsComposing
        && !event.compositionActive
        && event.keyCode !== 229;
}
