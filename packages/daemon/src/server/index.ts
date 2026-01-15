import { createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import chokidar, { type FSWatcher } from 'chokidar';
import { WebSocketServer, WebSocket } from 'ws';
import {
  unlinkSync,
  existsSync,
  writeFileSync,
  chmodSync,
  readFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  rmSync,
} from 'node:fs';
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
  getTransportConfig,
  type DaemonInfo,
  type SessionInfo,
  type ScreenshotResult,
  type StylesParams,
  type StylesResult,
  type DomParams,
  type DomResult,
  type DescribeParams,
  type ContextParams,
  type A11yParams,
  type DoctorResult,
  type DoctorCheck,
} from '@wig/canvas-core';
import { BrowserManager, type DescribeResult, type ContextResult } from '../browser/index.js';

export interface DaemonState {
  running: boolean;
}

type WatchSubscriber = {
  id: string;
  socket: Socket;
};

export class DaemonServer {
  private server: Server | null = null;
  private socketPath: string;
  private connections: Set<Socket> = new Set();
  private browserManager: BrowserManager;
  private launchOptions: { headless?: boolean };

  private nextSubscriberId = 1;
  private watchSubscribers: Map<string, WatchSubscriber> = new Map();
  private fsWatcher: FSWatcher | null = null;
  private watchPaths: string[] = [];
  private watchLive = false;
  private watchIntervalMs = 2000;
  private watchIntervalTimer: NodeJS.Timeout | null = null;
  private liveScreenshotMaxEntries = 20;
  private liveScreenshotIndex = 0;
  private liveCwd = process.cwd();

  private viewerHttpServer: ReturnType<typeof createHttpServer> | null = null;
  private viewerWsServer: WebSocketServer | null = null;
  private viewerClients: Set<WebSocket> = new Set();
  private viewerPort: number | null = null;
  private viewerUrl: string | null = null;
  private viewerRunning = false;
  private viewerLastFrame: string | null = null;
  private viewerCdpSession: import('playwright').CDPSession | null = null;

  private uiReadyQuietWindowMs = 250;
  private uiReadyMaxWaitMs = 5_000;
  private uiReadyTimer: NodeJS.Timeout | null = null;
  private uiReadyMaxTimer: NodeJS.Timeout | null = null;
  private uiReadyObserverInstalled = false;
  private lastError: import('@wig/canvas-core').ErrorInfo | null = null;

  constructor(options?: { headless?: boolean }) {
    this.socketPath = getSocketPath();
    this.launchOptions = { headless: options?.headless };
    this.browserManager = new BrowserManager(
      { headless: this.launchOptions.headless },
      {
        onUiEvent: (event) => {
          this.emitWatchEvent(event);
        },
        onNavigationEvent: (event) => {
          this.emitWatchEvent(event);
        },
      }
    );
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
    this.clearUiReadyTimers();
    await this.fsWatcher?.close();
    this.fsWatcher = null;

    await this.browserManager.closeBrowser();

    this.stopViewerInternal();

    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();

    this.watchSubscribers.clear();
    this.stopLiveInterval();

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

    if (request.method === 'watch.subscribe') {
      const subscriberId = this.registerWatchSubscriber(socket);
      const response: SuccessResponse<{ subscriberId: string }> = {
        id: request.id,
        ok: true,
        result: { subscriberId },
      };
      this.sendResponse(socket, response);
      return;
    }

    if (request.method === 'watch.unsubscribe') {
      const subscriberId = (request.params as { subscriberId?: string }).subscriberId;
      if (!subscriberId) {
        const response: ErrorResponse = {
          id: request.id,
          ok: false,
          error: {
            code: ErrorCodes.INPUT_MISSING,
            message: 'Missing required parameter: subscriberId',
            data: { category: 'input', retryable: false, param: 'subscriberId' },
          },
        };
        this.sendResponse(socket, response);
        return;
      }

      const removed = this.unregisterWatchSubscriber(subscriberId);
      const response: SuccessResponse<{ unsubscribed: boolean }> = {
        id: request.id,
        ok: true,
        result: { unsubscribed: removed },
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
        return this.handleConnect(
          id,
          params as {
            url: string;
            watchPaths?: string[];
            browser?: 'chromium' | 'firefox' | 'webkit';
            timeoutMs?: number;
            headless?: boolean;
          }
        );

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

      case 'watch.configure':
        return this.handleWatchConfigure(
          id,
          request.meta.cwd,
          params as { live?: boolean; intervalMs?: number; maxEntries?: number }
        );

      case 'viewer.start':
        return this.handleViewerStart(id, params as { port?: number });

      case 'viewer.stop':
        return this.handleViewerStop(id);

      case 'viewer.status':
        return this.handleViewerStatus(id);

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

      case 'a11y':
        return this.handleA11y(id, params as A11yParams);

      case 'diff':
        return this.handleDiff(
          id,
          request.meta.cwd,
          params as { selector?: string; since?: string; threshold?: number }
        );

      case 'doctor':
        return this.handleDoctor(id);

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

  private async handleConnect(
    id: RequestId,
    params: {
      url: string;
      watchPaths?: string[];
      browser?: 'chromium' | 'firefox' | 'webkit';
      timeoutMs?: number;
      retries?: number;
      backoffMs?: number;
      headless?: boolean;
    }
  ): Promise<Response> {
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

    if (
      params.browser &&
      params.browser !== 'chromium' &&
      params.browser !== 'firefox' &&
      params.browser !== 'webkit'
    ) {
      return {
        id,
        ok: false,
        error: {
          code: ErrorCodes.INPUT_ENUM_INVALID,
          message: 'Invalid --browser. Must be chromium, firefox, or webkit.',
          data: { category: 'input', retryable: false, param: 'browser' },
        },
      };
    }

    const watchPaths = (params.watchPaths ?? []).filter(
      (p) => typeof p === 'string' && p.length > 0
    );
    const retries = params.retries ?? 0;
    const backoffMs = params.backoffMs ?? 250;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const sessionState = await this.browserManager.connect(params.url, {
          watchPaths,
          engine: params.browser,
          timeoutMs: params.timeoutMs,
          headless: params.headless,
        });
        this.setWatchPaths(watchPaths);
        return this.successResponse(id, {
          connected: true,
          url: sessionState.url ?? undefined,
          browser: this.browserManager.getEngine(),
          viewport: sessionState.viewport,
          watchPaths: sessionState.watchPaths,
        } satisfies SessionInfo);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (attempt < retries && (message.includes('timeout') || message.includes('Timeout'))) {
          console.error(
            `Retrying connect (${String(attempt + 1)}/${String(retries)}) after ${String(backoffMs)}ms`
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
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
        const suggestion = message.includes('playwright install')
          ? 'Run: npx playwright install'
          : undefined;
        return {
          id,
          ok: false,
          error: {
            code: ErrorCodes.NAVIGATION_FAILED,
            message: `Failed to connect: ${message}`,
            data: {
              category: 'navigation',
              retryable: true,
              suggestion,
            },
          },
        };
      }
    }

    return {
      id,
      ok: false,
      error: {
        code: ErrorCodes.NAVIGATION_FAILED,
        message: 'Failed to connect after retries',
        data: { category: 'navigation', retryable: true },
      },
    };
  }

  private async handleDisconnect(id: RequestId): Promise<Response> {
    await this.browserManager.disconnect();
    this.setWatchPaths([]);
    this.clearUiReadyTimers();
    this.uiReadyObserverInstalled = false;
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
    params: {
      selector?: string;
      out?: string;
      inline?: boolean;
      timeoutMs?: number;
      retries?: number;
      backoffMs?: number;
    }
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

    const retries = params.retries ?? 0;
    const backoffMs = params.backoffMs ?? 250;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await this.browserManager.takeScreenshot({
          path: params.out,
          selector: params.selector,
          cwd,
          inline: params.inline,
          timeoutMs: params.timeoutMs,
        });
        return this.successResponse(id, result satisfies ScreenshotResult);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (attempt < retries && (message.includes('timeout') || message.includes('Timeout'))) {
          console.error(
            `Retrying screenshot (${String(attempt + 1)}/${String(retries)}) after ${String(backoffMs)}ms`
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
        if (message.includes('Timeout') || message.includes('timeout')) {
          return {
            id,
            ok: false,
            error: createTimeoutError(
              ErrorCodes.TIMEOUT_SELECTOR,
              `Screenshot timed out for selector: ${params.selector ?? 'viewport'}`,
              { suggestion: 'Increase --timeout or simplify the selector.' }
            ),
          };
        }
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

    return {
      id,
      ok: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'Screenshot failed after retries',
        data: { category: 'internal', retryable: false },
      },
    };
  }

  private getSessionStatus(): SessionInfo {
    const state = this.browserManager.getSessionState();
    return {
      connected: this.browserManager.isConnected(),
      url: state.url ?? undefined,
      browser: this.browserManager.getEngine(),
      viewport: state.viewport,
      watchPaths: this.watchPaths,
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

    const retries = params.retries ?? 0;
    const backoffMs = params.backoffMs ?? 250;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await this.browserManager.getStyles({
          selector: params.selector,
          props: params.props,
          timeoutMs: params.timeoutMs,
        });
        return this.successResponse(id, result satisfies StylesResult);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (attempt < retries && (message.includes('timeout') || message.includes('Timeout'))) {
          console.error(
            `Retrying styles (${String(attempt + 1)}/${String(retries)}) after ${String(backoffMs)}ms`
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
        if (message.includes('Timeout') || message.includes('timeout')) {
          return {
            id,
            ok: false,
            error: createTimeoutError(
              ErrorCodes.TIMEOUT_SELECTOR,
              `Styles timed out for selector: ${params.selector}`,
              { suggestion: 'Increase --timeout or check the selector.' }
            ),
          };
        }
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

    return {
      id,
      ok: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'Styles failed after retries',
        data: { category: 'internal', retryable: false },
      },
    };
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

    const retries = params.retries ?? 0;
    const backoffMs = params.backoffMs ?? 250;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await this.browserManager.getDom({
          selector: params.selector,
          depth: params.depth,
          timeoutMs: params.timeoutMs,
        });
        return this.successResponse(id, result satisfies DomResult);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (attempt < retries && (message.includes('timeout') || message.includes('Timeout'))) {
          console.error(
            `Retrying dom (${String(attempt + 1)}/${String(retries)}) after ${String(backoffMs)}ms`
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
        if (message.includes('Timeout') || message.includes('timeout')) {
          return {
            id,
            ok: false,
            error: createTimeoutError(
              ErrorCodes.TIMEOUT_SELECTOR,
              `Dom snapshot timed out for selector: ${params.selector ?? 'body'}`,
              { suggestion: 'Increase --timeout or reduce --depth.' }
            ),
          };
        }
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

    return {
      id,
      ok: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'Dom failed after retries',
        data: { category: 'internal', retryable: false },
      },
    };
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

    const retries = params.retries ?? 0;
    const backoffMs = params.backoffMs ?? 250;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await this.browserManager.getDescribe({
          selector: params.selector,
          timeoutMs: params.timeoutMs,
        });
        return this.successResponse(id, result satisfies DescribeResult);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (attempt < retries && (message.includes('timeout') || message.includes('Timeout'))) {
          console.error(
            `Retrying describe (${String(attempt + 1)}/${String(retries)}) after ${String(backoffMs)}ms`
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
        if (message.includes('Timeout') || message.includes('timeout')) {
          return {
            id,
            ok: false,
            error: createTimeoutError(
              ErrorCodes.TIMEOUT_SELECTOR,
              `Describe timed out for selector: ${params.selector}`,
              { suggestion: 'Increase --timeout or check the selector.' }
            ),
          };
        }
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

    return {
      id,
      ok: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'Describe failed after retries',
        data: { category: 'internal', retryable: false },
      },
    };
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

    const retries = params.retries ?? 0;
    const backoffMs = params.backoffMs ?? 250;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await this.browserManager.getContext({
          selector: params.selector,
          depth: params.depth,
          cwd,
          timeoutMs: params.timeoutMs,
        });
        return this.successResponse(id, result satisfies ContextResult);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (attempt < retries && (message.includes('timeout') || message.includes('Timeout'))) {
          console.error(
            `Retrying context (${String(attempt + 1)}/${String(retries)}) after ${String(backoffMs)}ms`
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
        if (message.includes('Timeout') || message.includes('timeout')) {
          return {
            id,
            ok: false,
            error: createTimeoutError(
              ErrorCodes.TIMEOUT_BROWSER,
              `Context timed out for selector: ${params.selector ?? 'body'}`,
              { suggestion: 'Increase --timeout or reduce --depth.' }
            ),
          };
        }
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

    return {
      id,
      ok: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'Context failed after retries',
        data: { category: 'internal', retryable: false },
      },
    };
  }

  private async handleA11y(id: RequestId, params: A11yParams): Promise<Response> {
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

    const level = params.level ?? 'AA';
    if (level !== 'A' && level !== 'AA' && level !== 'AAA') {
      return {
        id,
        ok: false,
        error: {
          code: ErrorCodes.INPUT_ENUM_INVALID,
          message: 'Invalid --level. Must be A, AA, or AAA.',
          data: { category: 'input', retryable: false, param: 'level' },
        },
      };
    }

    const retries = params.retries ?? 0;
    const backoffMs = params.backoffMs ?? 250;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await this.browserManager.getA11y({
          selector: params.selector,
          level: level as 'A' | 'AA' | 'AAA',
          timeoutMs: params.timeoutMs,
        });
        return this.successResponse(id, result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (attempt < retries && (message.includes('timeout') || message.includes('Timeout'))) {
          console.error(
            `Retrying a11y (${String(attempt + 1)}/${String(retries)}) after ${String(backoffMs)}ms`
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
        if (message.includes('@axe-core/playwright')) {
          return {
            id,
            ok: false,
            error: {
              code: ErrorCodes.BROWSER_NOT_READY,
              message: `A11y scan unavailable: ${message}`,
              data: {
                category: 'browser',
                retryable: false,
                suggestion:
                  'Install @axe-core/playwright and ensure Playwright browsers are installed.',
              },
            },
          };
        }
        if (message.includes('Timeout') || message.includes('timeout')) {
          return {
            id,
            ok: false,
            error: createTimeoutError(
              ErrorCodes.TIMEOUT_BROWSER,
              `A11y scan timed out for selector: ${params.selector ?? 'page'}`,
              { suggestion: 'Increase --timeout or simplify the page.' }
            ),
          };
        }
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
            message: `A11y scan failed: ${message}`,
            data: { category: 'internal', retryable: false },
          },
        };
      }
    }

    return {
      id,
      ok: false,
      error: {
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'A11y scan failed after retries',
        data: { category: 'internal', retryable: false },
      },
    };
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

  private registerWatchSubscriber(socket: Socket): string {
    const id = `sub_${String(this.nextSubscriberId++)}`;
    this.watchSubscribers.set(id, { id, socket });
    if (this.watchLive) {
      this.startLiveInterval(this.liveCwd);
    }
    return id;
  }

  private unregisterWatchSubscriber(subscriberId: string): boolean {
    const removed = this.watchSubscribers.delete(subscriberId);
    if (this.watchSubscribers.size === 0) {
      this.stopLiveInterval();
    }
    return removed;
  }

  private emitWatchEvent(event: unknown): void {
    const line = JSON.stringify(event) + '\n';
    for (const sub of this.watchSubscribers.values()) {
      try {
        sub.socket.write(line);
      } catch {
        this.watchSubscribers.delete(sub.id);
      }
    }

    const e = event as { type?: unknown; ts?: unknown };
    if (e && typeof e === 'object' && typeof e.type === 'string') {
      if (e.type === 'hmr_complete' || e.type === 'ui_changed') {
        this.scheduleUiReady();
      }
      if (e.type === 'ui_ready') {
        void this.captureLiveScreenshot(this.liveCwd);
      }
    }
  }

  private setWatchPaths(nextWatchPaths: string[]): void {
    const unique = [...new Set(nextWatchPaths)];
    this.watchPaths = unique;

    void this.fsWatcher?.close();
    this.fsWatcher = null;

    if (unique.length === 0) {
      return;
    }

    this.fsWatcher = chokidar.watch(unique, {
      ignoreInitial: true,
      ignored: [/(^|[\\/])node_modules([\\/]|$)/, /(^|[\\/])\.git([\\/]|$)/],
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
    });

    this.fsWatcher.on('all', (_eventName, path) => {
      this.emitWatchEvent({
        type: 'file_changed',
        ts: new Date().toISOString(),
        path,
      });
    });

    this.fsWatcher.on('error', (err) => {
      console.error('Watcher error:', err instanceof Error ? err.message : String(err));
    });
  }

  private scheduleUiReady(): void {
    const page = this.browserManager.getPage();
    if (!page) {
      return;
    }

    if (!this.uiReadyObserverInstalled) {
      this.uiReadyObserverInstalled = true;
      void page
        .exposeFunction('__canvas_notify_dom_mutation', () => {
          this.resetUiReadyTimers();
        })
        .catch(() => {
          this.uiReadyObserverInstalled = false;
        });

      void page
        .addInitScript(
          `
(() => {
  const fn = globalThis.__canvas_notify_dom_mutation;
  if (typeof fn !== 'function') return;
  if (typeof globalThis.MutationObserver !== 'function') return;

  const observer = new MutationObserver(() => {
    try {
      globalThis.__canvas_notify_dom_mutation();
    } catch {
    }
  });

  observer.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
    characterData: true,
  });
})();
`
        )
        .catch(() => {
          this.uiReadyObserverInstalled = false;
        });
    }

    this.resetUiReadyTimers();
  }

  private resetUiReadyTimers(): void {
    if (this.uiReadyTimer) {
      clearTimeout(this.uiReadyTimer);
    }

    this.uiReadyTimer = setTimeout(() => {
      this.emitWatchEvent({ type: 'ui_ready', ts: new Date().toISOString() });
      this.clearUiReadyTimers();
    }, this.uiReadyQuietWindowMs);

    if (!this.uiReadyMaxTimer) {
      this.uiReadyMaxTimer = setTimeout(() => {
        this.emitWatchEvent({ type: 'ui_ready', ts: new Date().toISOString() });
        this.clearUiReadyTimers();
      }, this.uiReadyMaxWaitMs);
    }
  }

  private clearUiReadyTimers(): void {
    if (this.uiReadyTimer) {
      clearTimeout(this.uiReadyTimer);
      this.uiReadyTimer = null;
    }
    if (this.uiReadyMaxTimer) {
      clearTimeout(this.uiReadyMaxTimer);
      this.uiReadyMaxTimer = null;
    }
  }

  private sendResponse(socket: Socket, response: Response): void {
    if (!response.ok) {
      this.lastError = response.error;
    }
    const json = JSON.stringify(response);
    socket.write(json + '\n');
  }

  private startLiveInterval(cwd: string): void {
    if (!this.watchLive) return;
    if (this.watchIntervalTimer) return;

    this.watchIntervalTimer = setInterval(() => {
      void this.captureLiveScreenshot(cwd);
    }, this.watchIntervalMs);
  }

  private stopLiveInterval(): void {
    if (this.watchIntervalTimer) {
      clearInterval(this.watchIntervalTimer);
      this.watchIntervalTimer = null;
    }
  }

  private rotateLiveScreenshots(liveDir: string): void {
    if (!existsSync(liveDir)) {
      return;
    }
    const entries = readdirSync(liveDir)
      .filter((name) => name.endsWith('.png'))
      .map((name) => ({ name, full: join(liveDir, name) }));

    if (entries.length <= this.liveScreenshotMaxEntries) {
      return;
    }

    entries.sort((a, b) => {
      const aStat = statSync(a.full);
      const bStat = statSync(b.full);
      return aStat.mtimeMs - bStat.mtimeMs;
    });

    const toRemove = entries.slice(0, entries.length - this.liveScreenshotMaxEntries);
    for (const entry of toRemove) {
      try {
        rmSync(entry.full, { force: true });
      } catch {}
    }
  }

  private async captureLiveScreenshot(cwd: string): Promise<void> {
    if (!this.watchLive || !this.browserManager.isConnected()) return;

    const liveDir = join(cwd, '.canvas', 'live');
    if (!existsSync(liveDir)) {
      mkdirSync(liveDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.liveScreenshotIndex += 1;
    const index = String(this.liveScreenshotIndex).padStart(6, '0');
    const outPath = join(liveDir, `${timestamp}-${index}.png`);

    try {
      const screenshot = await this.browserManager.takeScreenshot({
        cwd,
        path: outPath,
        inline: true,
      });
      this.emitWatchEvent({
        type: 'screenshot',
        ts: new Date().toISOString(),
        screenshot,
      });
      this.rotateLiveScreenshots(liveDir);
    } catch (err) {
      console.error('Live screenshot failed:', err instanceof Error ? err.message : String(err));
    }
  }

  private handleWatchConfigure(
    id: RequestId,
    cwd: string,
    params: { live?: boolean; intervalMs?: number; maxEntries?: number }
  ): Response {
    this.liveCwd = cwd;
    if (typeof params.live === 'boolean') {
      this.watchLive = params.live;
    }
    if (Number.isFinite(params.intervalMs) && (params.intervalMs ?? 0) >= 250) {
      this.watchIntervalMs = params.intervalMs ?? this.watchIntervalMs;
    }
    if (Number.isFinite(params.maxEntries) && (params.maxEntries ?? 0) > 0) {
      this.liveScreenshotMaxEntries = params.maxEntries ?? this.liveScreenshotMaxEntries;
    }

    if (this.watchLive) {
      this.startLiveInterval(cwd);
    } else {
      this.stopLiveInterval();
    }

    return this.successResponse(id, {
      live: this.watchLive,
      intervalMs: this.watchIntervalMs,
      maxEntries: this.liveScreenshotMaxEntries,
    });
  }

  private async handleViewerStart(id: RequestId, params: { port?: number }): Promise<Response> {
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

    const engine = this.browserManager.getEngine();
    if (engine !== 'chromium') {
      return {
        id,
        ok: false,
        error: {
          code: ErrorCodes.INPUT_CONSTRAINT_VIOLATED,
          message: 'Live viewer is only available for Chromium.',
          data: {
            category: 'browser',
            retryable: false,
            suggestion: 'Run connect with --browser chromium to enable viewer streaming.',
          },
        },
      };
    }

    if (this.viewerRunning) {
      return this.successResponse(id, {
        running: true,
        port: this.viewerPort ?? undefined,
        url: this.viewerUrl ?? undefined,
        browser: engine,
      });
    }

    const port = params.port ?? 9222;

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

    try {
      const httpServer = createHttpServer((req, res) => {
        if (!req.url || req.url === '/' || req.url.startsWith('/index')) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(this.getViewerHtml());
          return;
        }

        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
      });

      const wsServer = new WebSocketServer({ server: httpServer });
      wsServer.on('connection', (socket: WebSocket) => {
        this.viewerClients.add(socket);
        socket.on('close', () => {
          this.viewerClients.delete(socket);
        });
        if (this.viewerLastFrame) {
          try {
            socket.send(this.viewerLastFrame);
          } catch {
            this.viewerClients.delete(socket);
          }
        }
      });

      await new Promise<void>((resolve, reject) => {
        const onError = (err: Error) => {
          reject(err);
        };
        httpServer.once('error', onError);
        httpServer.listen(port, () => {
          httpServer.off('error', onError);
          resolve();
        });
      });

      const cdpSession = await page.context().newCDPSession(page);
      this.viewerCdpSession = cdpSession;
      cdpSession.on('Page.screencastFrame', (event: { data: string; sessionId: number }) => {
        void cdpSession.send('Page.screencastFrameAck', { sessionId: event.sessionId });
        const payload = JSON.stringify({ type: 'frame', data: event.data });
        this.viewerLastFrame = payload;
        for (const client of this.viewerClients) {
          try {
            client.send(payload);
          } catch {
            this.viewerClients.delete(client);
          }
        }
      });

      await cdpSession.send('Page.enable').catch(() => {});
      await cdpSession.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 70,
        maxWidth: 1280,
        maxHeight: 720,
        everyNthFrame: 1,
      });

      this.viewerHttpServer = httpServer;
      this.viewerWsServer = wsServer;
      this.viewerPort = port;
      this.viewerUrl = `http://127.0.0.1:${String(port)}`;
      this.viewerRunning = true;

      return this.successResponse(id, {
        running: true,
        port: this.viewerPort,
        url: this.viewerUrl,
        browser: engine,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.stopViewerInternal();
      return {
        id,
        ok: false,
        error: {
          code: ErrorCodes.INTERNAL_ERROR,
          message: `Failed to start viewer: ${message}`,
          data: { category: 'internal', retryable: false },
        },
      };
    }
  }

  private stopViewerInternal(): void {
    if (this.viewerCdpSession) {
      void this.viewerCdpSession.send('Page.stopScreencast').catch(() => {});
      this.viewerCdpSession = null;
    }

    for (const client of this.viewerClients) {
      try {
        client.close();
      } catch {}
    }
    this.viewerClients.clear();

    if (this.viewerWsServer) {
      this.viewerWsServer.close();
      this.viewerWsServer = null;
    }

    if (this.viewerHttpServer) {
      this.viewerHttpServer.close();
      this.viewerHttpServer = null;
    }

    this.viewerRunning = false;
    this.viewerPort = null;
    this.viewerUrl = null;
    this.viewerLastFrame = null;
  }

  private handleViewerStop(id: RequestId): Response {
    if (!this.viewerRunning) {
      return this.successResponse(id, { running: false });
    }

    this.stopViewerInternal();
    return this.successResponse(id, { running: false });
  }

  private handleViewerStatus(id: RequestId): Response {
    return this.successResponse(id, {
      running: this.viewerRunning,
      port: this.viewerPort ?? undefined,
      url: this.viewerUrl ?? undefined,
      browser: this.browserManager.getEngine(),
    });
  }

  private getViewerHtml(): string {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Canvas Viewer</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      background: #0b0b0b;
      height: 100%;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #frame {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      background: #000;
    }
    #status {
      position: fixed;
      top: 8px;
      left: 8px;
      padding: 4px 8px;
      background: rgba(0,0,0,0.6);
      color: #fff;
      font-family: sans-serif;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div id="status">connecting...</div>
  <img id="frame" />
  <script>
    (function() {
      const status = document.getElementById('status');
      const img = document.getElementById('frame');
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(proto + '://' + location.host);
      ws.addEventListener('open', () => {
        status.textContent = 'connected';
      });
      ws.addEventListener('close', () => {
        status.textContent = 'disconnected';
      });
      ws.addEventListener('message', (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (!payload || payload.type !== 'frame' || !payload.data) return;
          img.src = 'data:image/jpeg;base64,' + payload.data;
        } catch {}
      });
    })();
  </script>
</body>
</html>`;
  }

  private handleDoctor(id: RequestId): Response {
    const transport = getTransportConfig();
    const endpoint = getSocketPath();
    const checks: DoctorCheck[] = [];

    const { running, pid } = this.isDaemonRunning();
    checks.push({
      id: 'daemon_running',
      label: 'Daemon running',
      ok: running,
      detail: running ? `PID ${String(pid)}` : 'Not running',
      suggestion: running ? undefined : 'Run: canvas daemon start',
    });

    const socketExists = transport.type === 'unix' ? existsSync(endpoint) : null;
    if (transport.type === 'unix') {
      checks.push({
        id: 'socket_exists',
        label: 'Socket exists',
        ok: socketExists === true,
        detail: socketExists ? 'Socket file present' : 'Socket file not found',
        suggestion: socketExists ? undefined : 'Run: canvas daemon start',
      });
    }

    const browserReady = this.browserManager.isConnected();
    checks.push({
      id: 'browser_connected',
      label: 'Browser connected',
      ok: browserReady,
      detail: browserReady ? 'Active session connected' : 'No active session',
      suggestion: browserReady ? undefined : 'Run: canvas connect <url>',
    });

    const browserChecks = this.browserManager.getBrowserInstallChecks();
    const browsersOk = browserChecks.every((entry) => entry.installed);
    checks.push({
      id: 'browsers_installed',
      label: 'Playwright browsers installed',
      ok: browsersOk,
      detail: browserChecks
        .map(
          (entry) =>
            `${entry.engine}: ${entry.installed ? 'installed' : 'missing'} (${entry.executablePath})`
        )
        .join('; '),
      suggestion: browsersOk ? undefined : 'Run: npx playwright install',
    });

    const ok = checks.every((check) => check.ok);

    const result: DoctorResult = {
      ok,
      checks,
      endpoint,
      transport: transport.type,
      browsers: browserChecks,
      lastError: this.lastError ?? undefined,
    };

    return this.successResponse(id, result);
  }

  private isDaemonRunning(): { running: boolean; pid: number | null } {
    const pidFile = getPidFilePath();
    if (!existsSync(pidFile)) {
      return { running: false, pid: null };
    }

    try {
      const pidContent = readFileSync(pidFile, 'utf-8').trim();
      const pid = parseInt(pidContent, 10);
      try {
        process.kill(pid, 0);
        return { running: true, pid };
      } catch {
        return { running: false, pid };
      }
    } catch {
      return { running: false, pid: null };
    }
  }
}
