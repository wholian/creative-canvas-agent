export type CanvasValidationCode =
    | 'invalid_type'
    | 'invalid_value'
    | 'missing_field'
    | 'unknown_node_type';

export class CanvasValidationError extends Error {
    readonly code: CanvasValidationCode;
    readonly path: string;

    constructor(code: CanvasValidationCode, path: string, message: string) {
        super(message);
        this.name = 'CanvasValidationError';
        this.code = code;
        this.path = path;
    }
}

export function assertRecord(input: unknown, path: string): asserts input is Record<string, unknown> {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
        throw new CanvasValidationError('invalid_type', path, `${path} must be an object.`);
    }
}

export function readRequiredString(input: Record<string, unknown>, key: string, path: string): string {
    const value = input[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new CanvasValidationError('missing_field', `${path}.${key}`, `${path}.${key} must be a non-empty string.`);
    }
    return value;
}

export function readOptionalString(input: Record<string, unknown>, key: string, path: string): string | undefined {
    const value = input[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new CanvasValidationError('invalid_type', `${path}.${key}`, `${path}.${key} must be a non-empty string when provided.`);
    }
    return value;
}

export function readStringArray(
    input: Record<string, unknown>,
    key: string,
    path: string,
    defaultValue: string[] = [],
): string[] {
    const value = input[key];
    if (value === undefined) return [...defaultValue];
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item.length === 0)) {
        throw new CanvasValidationError('invalid_type', `${path}.${key}`, `${path}.${key} must be an array of non-empty strings.`);
    }
    return [...value];
}

export function readOptionalEnum<T extends string>(
    input: Record<string, unknown>,
    key: string,
    allowed: readonly T[],
    path: string,
): T | undefined {
    const value = input[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !allowed.includes(value as T)) {
        throw new CanvasValidationError(
            'invalid_value',
            `${path}.${key}`,
            `${path}.${key} must be one of: ${allowed.join(', ')}.`,
        );
    }
    return value as T;
}

export function readOptionalBoolean(input: Record<string, unknown>, key: string, path: string): boolean | undefined {
    const value = input[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'boolean') {
        throw new CanvasValidationError('invalid_type', `${path}.${key}`, `${path}.${key} must be a boolean.`);
    }
    return value;
}

export function readOptionalNumber(
    input: Record<string, unknown>,
    key: string,
    path: string,
    options: { min?: number; max?: number } = {},
): number | undefined {
    const value = input[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new CanvasValidationError('invalid_type', `${path}.${key}`, `${path}.${key} must be a finite number.`);
    }
    if ((options.min !== undefined && value < options.min) || (options.max !== undefined && value > options.max)) {
        throw new CanvasValidationError(
            'invalid_value',
            `${path}.${key}`,
            `${path}.${key} must be between ${options.min ?? '-∞'} and ${options.max ?? '∞'}.`,
        );
    }
    return value;
}
