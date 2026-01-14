import type { Response, OutputFormat } from '@wig/canvas-core';
import { isSuccessResponse } from '@wig/canvas-core';

export function render<T>(
  response: Response<T>,
  format: OutputFormat,
  textRenderer: (result: T) => void
): void {
  if (format === 'json') {
    if (isSuccessResponse(response)) {
      console.log(JSON.stringify({ ok: true, result: response.result }, null, 2));
    } else {
      console.log(JSON.stringify({ ok: false, error: response.error }, null, 2));
      process.exit(1);
    }
  } else if (format === 'yaml') {
    if (isSuccessResponse(response)) {
      console.log(toYaml({ ok: true, result: response.result }));
    } else {
      console.log(toYaml({ ok: false, error: response.error }));
      process.exit(1);
    }
  } else if (format === 'ndjson') {
    if (isSuccessResponse(response)) {
      console.log(JSON.stringify({ ok: true, result: response.result }));
    } else {
      console.log(JSON.stringify({ ok: false, error: response.error }));
      process.exit(1);
    }
  } else {
    if (isSuccessResponse(response)) {
      textRenderer(response.result);
    } else {
      console.error(`Error: ${response.error.message}`);
      if (response.error.data.suggestion) {
        console.error(`Suggestion: ${response.error.data.suggestion}`);
      }
      process.exit(1);
    }
  }
}

export function renderError(message: string, format: OutputFormat): void {
  if (format === 'json' || format === 'yaml' || format === 'ndjson') {
    const errorEnvelope = {
      ok: false,
      error: {
        code: 1001,
        message,
        data: { category: 'daemon', retryable: false },
      },
    };
    if (format === 'yaml') {
      console.log(toYaml(errorEnvelope));
    } else if (format === 'ndjson') {
      console.log(JSON.stringify(errorEnvelope));
    } else {
      console.log(JSON.stringify(errorEnvelope, null, 2));
    }
  } else {
    console.error(message);
  }
  process.exit(1);
}

function toYaml(obj: unknown, indent = 0): string {
  const spaces = '  '.repeat(indent);

  if (obj === null || obj === undefined) {
    return 'null';
  }

  if (typeof obj === 'boolean') {
    return obj ? 'true' : 'false';
  }

  if (typeof obj === 'number') {
    return String(obj);
  }

  if (typeof obj === 'string') {
    if (obj.includes('\n') || obj.includes(':') || obj.includes('#')) {
      return `"${obj.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return obj.map((item) => `${spaces}- ${toYaml(item, indent + 1).trimStart()}`).join('\n');
  }

  if (typeof obj === 'object') {
    const entries = Object.entries(obj);
    if (entries.length === 0) return '{}';
    return entries
      .map(([key, value]) => {
        const valueStr = toYaml(value, indent + 1);
        if (
          typeof value === 'object' &&
          value !== null &&
          (Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0)
        ) {
          return `${spaces}${key}:\n${valueStr}`;
        }
        return `${spaces}${key}: ${valueStr}`;
      })
      .join('\n');
  }

  return String(obj);
}
