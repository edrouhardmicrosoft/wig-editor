/**
 * Golden tests for CLI output renderer.
 * Run with: npx tsx packages/cli/src/__tests__/output.typetest.ts
 */
import type { Response } from '@wig/canvas-core';
import { generateRequestId } from '@wig/canvas-core';

const outputs: string[] = [];
const errors: string[] = [];
const originalLog = console.log;
const originalError = console.error;

const originalExit = process.exit;
let exitCode: number | undefined;

function setupMocks() {
  outputs.length = 0;
  errors.length = 0;
  exitCode = undefined;
  console.log = (...args: unknown[]) => outputs.push(args.map(String).join(' '));
  console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));
  process.exit = ((code?: number) => {
    exitCode = code ?? 0;
  }) as never;
}

function teardownMocks() {
  console.log = originalLog;
  console.error = originalError;
  process.exit = originalExit;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    teardownMocks();
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertOutput(expected: string, message: string): void {
  const actual = outputs.join('\n');
  if (actual !== expected) {
    teardownMocks();
    throw new Error(`${message}\nExpected:\n${expected}\n\nActual:\n${actual}`);
  }
}

function assertOutputContains(substring: string, message: string): void {
  const actual = outputs.join('\n');
  if (!actual.includes(substring)) {
    teardownMocks();
    throw new Error(`${message}\nExpected to contain: ${substring}\n\nActual:\n${actual}`);
  }
}

import { render, renderError } from '../output/index.js';

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

const GOLDEN_JSON_SUCCESS = `{
  "ok": true,
  "result": {
    "url": "https://example.com",
    "status": "connected"
  }
}`;

const GOLDEN_JSON_ERROR = `{
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
}`;

const GOLDEN_NDJSON_SUCCESS = `{"ok":true,"result":{"url":"https://example.com","status":"connected"}}`;

const GOLDEN_YAML_SUCCESS = `ok: true
result:
  url: "https://example.com"
  status: connected`;

function testJsonSuccessOutput(): void {
  setupMocks();
  render(sampleSuccessResponse, 'json', () => {});
  assertOutput(GOLDEN_JSON_SUCCESS, 'JSON success output should match golden');
  assert(exitCode === undefined, 'Success should not call process.exit');
  teardownMocks();
  originalLog('  JSON success: PASS');
}

function testJsonErrorOutput(): void {
  setupMocks();
  render(sampleErrorResponse, 'json', () => {});
  assertOutput(GOLDEN_JSON_ERROR, 'JSON error output should match golden');
  assert(exitCode === 1, 'Error should exit with code 1');
  teardownMocks();
  originalLog('  JSON error: PASS');
}

function testNdjsonSuccessOutput(): void {
  setupMocks();
  render(sampleSuccessResponse, 'ndjson', () => {});
  assertOutput(GOLDEN_NDJSON_SUCCESS, 'NDJSON success output should match golden');
  assert(exitCode === undefined, 'Success should not call process.exit');
  teardownMocks();
  originalLog('  NDJSON success: PASS');
}

function testYamlSuccessOutput(): void {
  setupMocks();
  render(sampleSuccessResponse, 'yaml', () => {});
  assertOutput(GOLDEN_YAML_SUCCESS, 'YAML success output should match golden');
  assert(exitCode === undefined, 'Success should not call process.exit');
  teardownMocks();
  originalLog('  YAML success: PASS');
}

function testTextSuccessOutput(): void {
  setupMocks();
  let textRendererCalled = false;
  render(sampleSuccessResponse, 'text', (result) => {
    textRendererCalled = true;
    assert(result.url === 'https://example.com', 'Text renderer receives result');
    assert(result.status === 'connected', 'Text renderer receives full result');
  });
  assert(textRendererCalled, 'Text format should call the text renderer');
  assert(exitCode === undefined, 'Success should not call process.exit');
  teardownMocks();
  originalLog('  Text success: PASS');
}

function testTextErrorOutput(): void {
  setupMocks();
  let textRendererCalled = false;
  render(sampleErrorResponse, 'text', () => {
    textRendererCalled = true;
  });
  assert(!textRendererCalled, 'Error should not call text renderer');
  assert(errors.length > 0, 'Error should write to stderr');
  assertOutputContains('', 'stdout should be empty for text errors');
  assert(errors[0]?.includes('Element not found') ?? false, 'Error message in stderr');
  assert(exitCode === 1, 'Error should exit with code 1');
  teardownMocks();
  originalLog('  Text error: PASS');
}

function testRenderErrorJson(): void {
  setupMocks();
  renderError('Daemon not running', 'json');
  const parsed = JSON.parse(outputs[0] ?? '{}');
  assert(parsed.ok === false, 'renderError should set ok: false');
  assert(parsed.error.code === 1001, 'renderError uses code 1001');
  assert(parsed.error.message === 'Daemon not running', 'renderError includes message');
  assert(parsed.error.data.category === 'daemon', 'renderError sets category');
  assert(exitCode === 1, 'renderError should exit with code 1');
  teardownMocks();
  originalLog('  renderError JSON: PASS');
}

function testRenderErrorYaml(): void {
  setupMocks();
  renderError('Connection failed', 'yaml');
  assertOutputContains('ok: false', 'YAML error should contain ok: false');
  assertOutputContains('message: Connection failed', 'YAML error should contain message');
  assert(exitCode === 1, 'renderError should exit with code 1');
  teardownMocks();
  originalLog('  renderError YAML: PASS');
}

function testRenderErrorText(): void {
  setupMocks();
  renderError('Something went wrong', 'text');
  assert(outputs.length === 0, 'Text error should not write to stdout');
  assert(errors[0] === 'Something went wrong', 'Text error writes to stderr');
  assert(exitCode === 1, 'renderError should exit with code 1');
  teardownMocks();
  originalLog('  renderError text: PASS');
}

function typeTests(): void {
  const _r1: Response<{ data: string }> = {
    id: generateRequestId(),
    ok: true,
    result: { data: 'test' },
  };
  render(_r1, 'json', (r) => {
    const _check: string = r.data;
    console.log(_check);
  });

  const _formats: Array<'text' | 'json' | 'yaml' | 'ndjson'> = ['text', 'json', 'yaml', 'ndjson'];
  _formats.forEach((f) => render(_r1, f, () => {}));
}

async function main(): Promise<void> {
  originalLog('\nOutput Renderer Golden Tests\n============================\n');

  try {
    testJsonSuccessOutput();
    testJsonErrorOutput();
    testNdjsonSuccessOutput();
    testYamlSuccessOutput();
    testTextSuccessOutput();
    testTextErrorOutput();
    testRenderErrorJson();
    testRenderErrorYaml();
    testRenderErrorText();
    typeTests();

    originalLog('\nAll tests passed!\n');
  } catch (e) {
    teardownMocks();
    originalError('\nTest failed:', (e as Error).message);
    originalExit(1);
  }
}

main();
