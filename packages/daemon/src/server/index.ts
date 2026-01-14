import { createServer, type Server, type Socket } from 'node:net';
import { unlinkSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import {
  type Request,
  type Response,
  type SuccessResponse,
  type ErrorResponse,
  type RequestId,
  ErrorCodes,
  createDaemonError,
  createTimeoutError,
  createSelectorError,
  PROTOCOL_VERSION,
  DAEMON_VERSION,
  isCompatible,
  getSocketPath,
  getPidFilePath,
  type DaemonInfo,
  type SessionInfo,
  type ScreenshotResult,
  type StylesParams,
  type StylesResult,
  type DomParams,
  type DomResult,
  type DescribeParams,
  type ContextParams,
} from '@wig/canvas-core';
import { BrowserManager, type DescribeResult, type ContextResult } from '../browser/index.js';

export interface DaemonState {
  running: boolean;
}

export class DaemonServer {
  private server: Server | null = null;
  private socketPath: string;
  private connections: Set<Socket> = new Set();
  private browserManager: BrowserManager;

  constructor() {
    this.socketPath = getSocketPath();
    this.browserManager = new BrowserManager();
  }

  async start(): Promise<void> {
    if (existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }

    this.server = createServer((socket) => {
      this.handleConnection(socket);
    });

    return new Promise((resolve, reject) => {
      this.server?.on('error', reject);
      this.server?.listen(this.socketPath, () => {
        chmodSync(this.socketPath, 0o600);
        writeFileSync(getPidFilePath(), String(process.pid), { mode: 0o600 });
        console.error(`Daemon listening on ${this.socketPath}`);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    await this.browserManager.closeBrowser();

    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();

    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          if (existsSync(this.socketPath)) {
            unlinkSync(this.socketPath);
          }
          if (existsSync(getPidFilePath())) {
            unlinkSync(getPidFilePath());
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private handleConnection(socket: Socket): void {
    this.connections.add(socket);

    let buffer = '';

    socket.on('data', (data) => {
      buffer += data.toString();

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        if (line.trim()) {
          void this.handleMessage(socket, line);
        }
      }
    });

    socket.on('close', () => {
      this.connections.delete(socket);
    });

    socket.on('error', (err) => {
      console.error('Socket error:', err.message);
      this.connections.delete(socket);
    });
  }

  private async handleMessage(socket: Socket, message: string): Promise<void> {
    let request: Request;

    try {
      request = JSON.parse(message) as Request;
    } catch {
      const response: ErrorResponse = {
        id: 'req_unknown',
        ok: false,
        error: {
          code: ErrorCodes.INPUT_INVALID,
          message: 'Invalid JSON in request',
          data: { category: 'input', retryable: false },
        },
      };
      this.sendResponse(socket, response);
      return;
    }

    const clientProtocolVersion = request.meta.protocolVersion;
    if (!isCompatible(clientProtocolVersion, PROTOCOL_VERSION)) {
      const response: ErrorResponse = {
        id: request.id,
        ok: false,
        error: createDaemonError(
          ErrorCodes.PROTOCOL_VERSION_MISMATCH,
          `Protocol version mismatch: client ${clientProtocolVersion}, daemon ${PROTOCOL_VERSION}`,
          {
            retryable: false,
            suggestion: `Upgrade your CLI to match daemon protocol version ${PROTOCOL_VERSION}`,
          }
        ),
      };
      this.sendResponse(socket, response);
      return;
    }

    const response = await this.dispatch(request);
    this.sendResponse(socket, response);
  }

  private async dispatch(request: Request): Promise<Response> {
    const { id, method, params } = request;

    switch (method) {
      case 'ping':
        return this.successResponse(id, { pong: true });

      case 'daemon.status':
        return this.successResponse(id, this.getDaemonStatus());

      case 'daemon.stop':
        setImmediate(() => {
          void this.stop().then(() => process.exit(0));
        });
        return this.successResponse(id, { stopping: true });

      case 'connect':
        return this.handleConnect(id, params as { url: string });

      case 'disconnect':
        return this.handleDisconnect(id);

      case 'status':
        return this.successResponse(id, this.getSessionStatus());

      case 'screenshot.viewport':
        return this.handleScreenshot(id, request.meta.cwd, params as { out?: string });

      case 'screenshot.element':
        return this.handleScreenshot(
          id,
          request.meta.cwd,
          params as { selector: string; out?: string }
        );

      case 'execute':
        return this.handleExecute(id, params as { code: string; timeoutMs?: number });

      case 'styles':
        return this.handleStyles(id, params as StylesParams);

      case 'dom':
        return this.handleDom(id, params as DomParams);

      case 'describe':
        return this.handleDescribe(id, params as DescribeParams);

      case 'context':
        return this.handleContext(id, request.meta.cwd, params as ContextParams);

      case 'diff':
        return this.handleDiff(
          id,
          request.meta.cwd,
          params as { selector?: string; since?: string; threshold?: number }
        );

      default:
        return {
          id,
          ok: false,
          error: {
            code: ErrorCodes.INPUT_INVALID,
            message: `Unknown method: ${method}`,
            data: { category: 'input', retryable: false, param: 'method' },
          },
        };
    }
  }

  private async handleConnect(id: RequestId, params: { url: string }): Promise<Response> {
    if (!params.url) {
      return {
        id,
        ok: false,
        error: {
          code: ErrorCodes.INPUT_MISSING,
          message: 'Missing required parameter: url',
          data: { category: 'input', retryable: false, param: 'url' },
        },
      };
    }

    try {
      const sessionState = await this.browserManager.connect(params.url);
      return this.successResponse(id, {
        connected: true,
        url: sessionState.url ?? undefined,
        browser: this.browserManager.getEngine(),
        viewport: sessionState.viewport,
      } satisfies SessionInfo);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Timeout') || message.includes('timeout')) {
        return {
          id,
          ok: false,
          error: createTimeoutError(
            ErrorCodes.NAVIGATION_TIMEOUT,
            `Navigation timeout: ${params.url}`,
            { suggestion: 'Check if the URL is accessible and try again' }
          ),
        };
      }
      return {
        id,
        ok: false,
        error: {
          code: ErrorCodes.NAVIGATION_FAILED,
          message: `Failed to connect: ${message}`,
          data: { category: 'navigation', retryable: true },
        },
      };
    }
  }

  private async handleDisconnect(id: RequestId): Promise<Response> {
    await this.browserManager.disconnect();
    return this.successResponse(id, { disconnected: true });
  }

  private async handleExecute(
    id: RequestId,
    params: { code: string; timeoutMs?: number }
  ): Promise<Response> {
    if (!this.browserManager.isConnected()) {
      return {
        id,
        ok: false,
        error: {
          code: ErrorCodes.PAGE_NOT_READY,
          message: 'No page connected. Use connect first.',
          data: { category: 'browser', retryable: false },
        },
      };
    }

    if (!params.code || typeof params.code !== 'string') {
      return {
        id,
        ok: false,
        error: {
          code: ErrorCodes.INPUT_MISSING,
          message: 'Missing required parameter: code',
          data: { category: 'input', retryable: false, param: 'code' },
        },
      };
    }

    const page = this.browserManager.getPage();
    if (!page) {
      return {
        id,
        ok: false,
        error: {
          code: ErrorCodes.PAGE_NOT_READY,
          message: 'No page connected. Use connect first.',
          data: { category: 'browser', retryable: false },
        },
      };
    }

    const timeoutMs = params.timeoutMs ?? 5_000;

    let timeoutId: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(
          createTimeoutError(
            ErrorCodes.EXECUTE_TIMEOUT,
            `Execute timed out after ${String(timeoutMs)}ms`,
            { suggestion: 'Increase --timeout-ms or simplify the script' }
          )
        );
      }, timeoutMs);
    });

    try {
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
        ...args: string[]
      ) => (...fnArgs: unknown[]) => Promise<unknown>;

      const userFn = new AsyncFunction('page', `"use strict";\n${params.code}`) as (
        page: unknown
      ) => Promise<unknown>;

      const value = await Promise.race([userFn(page), timeoutPromise]);
      return this.successResponse(id, { value });
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && 'data' in err) {
        const canvasErr = err as {
          code: number;
          message: string;
          data: { category: string; retryable: boolean; suggestion?: string };
        };
        return {
          id,
          ok: false,
          error: { code: canvasErr.code, message: canvasErr.message, data: canvasErr.data },
        };
      }

      const message = err instanceof Error ? err.message : String(err);
      return {
        id,
        ok: false,
        error: {
          code: ErrorCodes.EXECUTE_FAILED,
          message: `Execute failed: ${message}`,
          data: { category: 'internal', retryable: false },
        },
      };
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  private async handleScreenshot(
    id: RequestId,
    cwd: string,
    params: { selector?: string; out?: string; inline?: boolean }
  ): Promise<Response> {
    if (!this.browserManager.isConnected()) {
      return {
        id,
        ok: false,
        error: {
          code: ErrorCodes.PAGE_NOT_READY,
          message: 'No page connected. Use connect first.',
          data: { category: 'browser', retryable: false },
        },
      };
    }

    try {
      const result = await this.browserManager.takeScreenshot({
        path: params.out,
        selector: params.selector,
        cwd,
        inline: params.inline,
      });
      return this.successResponse(id, result satisfies ScreenshotResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('selector') || message.includes('locator')) {
        const selector = params.selector ?? 'unknown';
        const candidates = await this.browserManager.getSelectorCandidates(selector);
        return {
          id,
          ok: false,
          error: createSelectorError(
            ErrorCodes.SELECTOR_NOT_FOUND,
            `Selector not found: ${selector}`,
            selector,
            { candidates }
          ),
        };
      }
      return {
        id,
        ok: false,
        error: {
          code: ErrorCodes.INTERNAL_ERROR,
          message: `Screenshot failed: ${message}`,
          data: { category: 'internal', retryable: false },
        },
      };
    }
  }

  private getSessionStatus(): SessionInfo {
    const state = this.browserManager.getSessionState();
    return {
      connected: this.browserManager.isConnected(),
      url: state.url ?? undefined,
      browser: this.browserManager.getEngine(),
      viewport: state.viewport,
    };
  }

  private async handleStyles(id: RequestId, params: StylesParams): Promise<Response> {
    if (!this.browserManager.isConnected()) {
      return {
        id,
        ok: false,
        error: {
          code: ErrorCodes.PAGE_NOT_READY,
          message: 'No page connected. Use connect first.',
          data: { category: 'browser', retryable: false },
        },
      };
    }

    if (!params.selector) {
      return {
        id,
        ok: false,
        error: {
          code: ErrorCodes.INPUT_MISSING,
          message: 'Missing required parameter: selector',
          data: { category: 'input', retryable: false, param: 'selector' },
        },
      };
    }

    try {
      const result = await this.browserManager.getStyles({
        selector: params.selector,
        props: params.props,
      });
      return this.successResponse(id, result satisfies StylesResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('selector') || message.includes('locator')) {
        const candidates = await this.browserManager.getSelectorCandidates(params.selector);
        return {
          id,
          ok: false,
          error: createSelectorError(
            ErrorCodes.SELECTOR_NOT_FOUND,
            `Selector not found: ${params.selector}`,
            params.selector,
            { candidates }
          ),
        };
      }
      return {
        id,
        ok: false,
        error: {
          code: ErrorCodes.INTERNAL_ERROR,
          message: `Styles failed: ${message}`,
          data: { category: 'internal', retryable: false },
        },
      };
    }
  }

  private async handleDom(id: RequestId, params: DomParams): Promise<Response> {
    if (!this.browserManager.isConnected()) {
      return {
        id,
        ok: false,
        error: {
          code: ErrorCodes.PAGE_NOT_READY,
          message: 'No page connected. Use connect first.',
          data: { category: 'browser', retryable: false },
        },
      };
    }

    try {
      const result = await this.browserManager.getDom({
        selector: params.selector,
        depth: params.depth,
      });
      return this.successResponse(id, result satisfies DomResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('selector') || message.includes('locator')) {
        const selector = params.selector ?? 'body';
        const candidates = await this.browserManager.getSelectorCandidates(selector);
        return {
          id,
          ok: false,
          error: createSelectorError(
            ErrorCodes.SELECTOR_NOT_FOUND,
            `Selector not found: ${selector}`,
            selector,
            { candidates }
          ),
        };
      }
      return {
        id,
        ok: false,
        error: {
          code: ErrorCodes.INTERNAL_ERROR,
          message: `Dom failed: ${message}`,
          data: { category: 'internal', retryable: false },
        },
      };
    }
  }

  private async handleDescribe(id: RequestId, params: DescribeParams): Promise<Response> {
    if (!this.browserManager.isConnected()) {
      return {
        id,
        ok: false,
        error: {
          code: ErrorCodes.PAGE_NOT_READY,
          message: 'No page connected. Use connect first.',
          data: { category: 'browser', retryable: false },
        },
      };
    }

    if (!params.selector) {
      return {
        id,
        ok: false,
        error: {
          code: ErrorCodes.INPUT_MISSING,
          message: 'Missing required parameter: selector',
          data: { category: 'input', retryable: false, param: 'selector' },
        },
      };
    }

    try {
      const result = await this.browserManager.getDescribe({
        selector: params.selector,
      });
      return this.successResponse(id, result satisfies DescribeResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('selector') || message.includes('locator')) {
        const candidates = await this.browserManager.getSelectorCandidates(params.selector);
        return {
          id,
          ok: false,
          error: createSelectorError(
            ErrorCodes.SELECTOR_NOT_FOUND,
            `Selector not found: ${params.selector}`,
            params.selector,
            { candidates }
          ),
        };
      }
      return {
        id,
        ok: false,
        error: {
          code: ErrorCodes.INTERNAL_ERROR,
          message: `Describe failed: ${message}`,
          data: { category: 'internal', retryable: false },
        },
      };
    }
  }

  private async handleContext(
    id: RequestId,
    cwd: string,
    params: ContextParams
  ): Promise<Response> {
    if (!this.browserManager.isConnected()) {
      return {
        id,
        ok: false,
        error: {
          code: ErrorCodes.PAGE_NOT_READY,
          message: 'No page connected. Use connect first.',
          data: { category: 'browser', retryable: false },
        },
      };
    }

    try {
      const result = await this.browserManager.getContext({
        selector: params.selector,
        depth: params.depth,
        cwd,
      });
      return this.successResponse(id, result satisfies ContextResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('selector') || message.includes('locator')) {
        const selector = params.selector ?? 'body';
        const candidates = await this.browserManager.getSelectorCandidates(selector);
        return {
          id,
          ok: false,
          error: createSelectorError(
            ErrorCodes.SELECTOR_NOT_FOUND,
            `Selector not found: ${selector}`,
            selector,
            { candidates }
          ),
        };
      }
      return {
        id,
        ok: false,
        error: {
          code: ErrorCodes.INTERNAL_ERROR,
          message: `Context failed: ${message}`,
          data: { category: 'internal', retryable: false },
        },
      };
    }
  }

  private async handleDiff(
    id: RequestId,
    cwd: string,
    params: { selector?: string; since?: string; threshold?: number }
  ): Promise<Response> {
    if (!this.browserManager.isConnected()) {
      return {
        id,
        ok: false,
        error: {
          code: ErrorCodes.PAGE_NOT_READY,
          message: 'No page connected. Use connect first.',
          data: { category: 'browser', retryable: false },
        },
      };
    }

    try {
      const result = await this.browserManager.takeDiff({
        cwd,
        selector: params.selector,
        since: params.since,
        threshold: params.threshold,
      });
      return this.successResponse(id, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        id,
        ok: false,
        error: {
          code: ErrorCodes.INTERNAL_ERROR,
          message: `Diff failed: ${message}`,
          data: { category: 'internal', retryable: false },
        },
      };
    }
  }

  private getDaemonStatus(): DaemonInfo {
    return {
      pid: process.pid,
      socketPath: this.socketPath,
      version: DAEMON_VERSION,
      protocolVersion: PROTOCOL_VERSION,
    };
  }

  private successResponse<T>(id: RequestId, result: T): SuccessResponse<T> {
    return { id, ok: true, result };
  }

  private sendResponse(socket: Socket, response: Response): void {
    const json = JSON.stringify(response);
    socket.write(json + '\n');
  }
}
