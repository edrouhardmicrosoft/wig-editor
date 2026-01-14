import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Response } from '@wig/canvas-core';
import { generateRequestId } from '@wig/canvas-core';
import { render, renderError } from '../output/index.js';

const outputs: string[] = [];
const errors: string[] = [];
let exitCode: number | undefined;

const originalLog = console.log;
const originalError = console.error;
const originalExit = process.exit;

beforeEach(() => {
  outputs.length = 0;
  errors.length = 0;
  exitCode = undefined;
  console.log = (...args: unknown[]) => outputs.push(args.map(String).join(' '));
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));
  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
  }) as never;
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalError;
  process.exit = originalExit;
});

const sampleSuccessResponse: Response<{ url: string; status: string }> = {
  id: generateRequestId(),
  ok: true,
  result: {
    url: 'https://example.com',
    status: 'connected',
  },
};

const sampleErrorResponse: Response<{ url: string }> = {
  id: generateRequestId(),
  ok: false,
  error: {
    code: 3001,
    message: 'Element not found',
    data: {
      category: 'selector',
      retryable: true,
      param: 'selector',
      suggestion: "Try using '.hero-section' instead",
    },
  },
};

describe('Output Renderer', () => {
  describe('JSON format', () => {
    it('renders success response correctly', () => {
      render(sampleSuccessResponse, 'json', () => {});

      expect(outputs.join('\n')).toMatchInlineSnapshot(`
        "{
          "ok": true,
          "result": {
            "url": "https://example.com",
            "status": "connected"
          }
        }"
      `);
      expect(exitCode).toBeUndefined();
    });

    it('renders error response correctly', () => {
      render(sampleErrorResponse, 'json', () => {});

      expect(outputs.join('\n')).toMatchInlineSnapshot(`
        "{
          "ok": false,
          "error": {
            "code": 3001,
            "message": "Element not found",
            "data": {
              "category": "selector",
              "retryable": true,
              "param": "selector",
              "suggestion": "Try using '.hero-section' instead"
            }
          }
        }"
      `);
      expect(exitCode).toBe(1);
    });
  });

  describe('NDJSON format', () => {
    it('renders success response as single line', () => {
      render(sampleSuccessResponse, 'ndjson', () => {});

      expect(outputs.join('\n')).toMatchInlineSnapshot(
        `"{"ok":true,"result":{"url":"https://example.com","status":"connected"}}"`
      );
      expect(exitCode).toBeUndefined();
    });

    it('renders error response as single line', () => {
      render(sampleErrorResponse, 'ndjson', () => {});

      const parsed = JSON.parse(outputs[0] ?? '{}');
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe(3001);
      expect(exitCode).toBe(1);
    });
  });

  describe('YAML format', () => {
    it('renders success response correctly', () => {
      render(sampleSuccessResponse, 'yaml', () => {});

      expect(outputs.join('\n')).toMatchInlineSnapshot(`
        "ok: true
        result:
          url: "https://example.com"
          status: connected"
      `);
      expect(exitCode).toBeUndefined();
    });

    it('renders error response correctly', () => {
      render(sampleErrorResponse, 'yaml', () => {});

      expect(outputs.join('\n')).toContain('ok: false');
      expect(outputs.join('\n')).toContain('code: 3001');
      expect(exitCode).toBe(1);
    });
  });

  describe('Text format', () => {
    it('calls text renderer for success response', () => {
      let called = false;
      render(sampleSuccessResponse, 'text', (result) => {
        called = true;
        expect(result.url).toBe('https://example.com');
        expect(result.status).toBe('connected');
      });

      expect(called).toBe(true);
      expect(exitCode).toBeUndefined();
    });

    it('outputs error to stderr for error response', () => {
      let called = false;
      render(sampleErrorResponse, 'text', () => {
        called = true;
      });

      expect(called).toBe(false);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('Element not found');
      expect(exitCode).toBe(1);
    });

    it('includes suggestion in error output', () => {
      render(sampleErrorResponse, 'text', () => {});

      expect(errors.some((e) => e.includes('.hero-section'))).toBe(true);
    });
  });

  describe('renderError', () => {
    it('renders JSON error envelope', () => {
      renderError('Daemon not running', 'json');

      const parsed = JSON.parse(outputs[0] ?? '{}');
      expect(parsed.ok).toBe(false);
      expect(parsed.error.code).toBe(1001);
      expect(parsed.error.message).toBe('Daemon not running');
      expect(parsed.error.data.category).toBe('daemon');
      expect(exitCode).toBe(1);
    });

    it('renders YAML error envelope', () => {
      renderError('Connection failed', 'yaml');

      expect(outputs.join('\n')).toContain('ok: false');
      expect(outputs.join('\n')).toContain('message: Connection failed');
      expect(exitCode).toBe(1);
    });

    it('renders NDJSON error as single line', () => {
      renderError('Socket error', 'ndjson');

      const parsed = JSON.parse(outputs[0] ?? '{}');
      expect(parsed.ok).toBe(false);
      expect(parsed.error.message).toBe('Socket error');
      expect(exitCode).toBe(1);
    });

    it('writes text error to stderr', () => {
      renderError('Something went wrong', 'text');

      expect(outputs.length).toBe(0);
      expect(errors[0]).toBe('Something went wrong');
      expect(exitCode).toBe(1);
    });
  });
});
