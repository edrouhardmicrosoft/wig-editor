export type ErrorCategory =
  | 'daemon'
  | 'transport'
  | 'handshake'
  | 'timeout'
  | 'navigation'
  | 'browser'
  | 'selector'
  | 'dom'
  | 'filesystem'
  | 'artifact'
  | 'input'
  | 'validation'
  | 'internal';

export interface CanvasErrorData {
  category: ErrorCategory;
  retryable: boolean;
  param?: string;
  suggestion?: string;
}

export interface CanvasError {
  code: number;
  message: string;
  data: CanvasErrorData;
}

export const ErrorCodes = {
  DAEMON_NOT_RUNNING: 1001,
  DAEMON_ALREADY_RUNNING: 1002,
  TRANSPORT_CONNECT_FAILED: 1003,
  TRANSPORT_CLOSED: 1004,
  HANDSHAKE_FAILED: 1005,
  PROTOCOL_VERSION_MISMATCH: 1006,

  TIMEOUT_NAVIGATION: 2001,
  TIMEOUT_SELECTOR: 2002,
  TIMEOUT_BROWSER: 2003,
  NAVIGATION_TIMEOUT: 2004,
  EXECUTE_TIMEOUT: 2008,
  EXECUTE_FAILED: 9003,
  NAVIGATION_FAILED: 2005,
  PAGE_NOT_READY: 2006,
  BROWSER_NOT_READY: 2007,

  SELECTOR_INVALID: 3001,
  SELECTOR_NOT_FOUND: 3002,
  SELECTOR_AMBIGUOUS: 3003,
  DOM_ACCESS_FAILED: 3004,

  FILESYSTEM_WRITE_FAILED: 4001,
  FILESYSTEM_READ_FAILED: 4002,
  ARTIFACT_PATH_INVALID: 4003,
  ARTIFACT_NOT_FOUND: 4004,

  INPUT_INVALID: 5001,
  INPUT_MISSING: 5002,
  INPUT_TIMESTAMP_INVALID: 5003,
  INPUT_ENUM_INVALID: 5004,
  INPUT_CONSTRAINT_VIOLATED: 5005,

  INTERNAL_ERROR: 9001,
  UNEXPECTED_ERROR: 9002,
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export function createError(code: ErrorCode, message: string, data: CanvasErrorData): CanvasError {
  return { code, message, data };
}

export function createDaemonError(
  code: ErrorCode,
  message: string,
  options: { retryable?: boolean; suggestion?: string } = {}
): CanvasError {
  return createError(code, message, {
    category: 'daemon',
    retryable: options.retryable ?? false,
    suggestion: options.suggestion,
  });
}

export function createSelectorError(
  code: ErrorCode,
  message: string,
  selector: string,
  options: { suggestion?: string; candidates?: string[] } = {}
): CanvasError {
  let suggestion = options.suggestion;
  if (!suggestion) {
    if (options.candidates && options.candidates.length > 0) {
      const candidateList = options.candidates.slice(0, 5).join(', ');
      suggestion = `Selector '${selector}' not found. Try: ${candidateList}`;
    } else {
      suggestion = `Selector '${selector}' not found. Check the selector syntax or use 'canvas dom' to inspect the page structure.`;
    }
  }
  return createError(code, message, {
    category: 'selector',
    retryable: true,
    param: 'selector',
    suggestion,
  });
}

export function createTimeoutError(
  code: ErrorCode,
  message: string,
  options: { retryable?: boolean; suggestion?: string } = {}
): CanvasError {
  return createError(code, message, {
    category: 'timeout',
    retryable: options.retryable ?? true,
    suggestion: options.suggestion,
  });
}

export function createInputError(
  code: ErrorCode,
  message: string,
  param: string,
  options: { suggestion?: string } = {}
): CanvasError {
  return createError(code, message, {
    category: 'input',
    retryable: false,
    param,
    suggestion: options.suggestion,
  });
}

export function createInternalError(message: string): CanvasError {
  return createError(ErrorCodes.INTERNAL_ERROR, message, {
    category: 'internal',
    retryable: false,
  });
}
