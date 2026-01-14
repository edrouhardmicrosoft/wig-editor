export type BrowserEngine = 'chromium' | 'firefox' | 'webkit';

export type TransportType = 'unix' | 'pipe';

export interface TransportConfig {
  type: TransportType;
  path: string;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SessionInfo {
  connected: boolean;
  url?: string;
  browser?: BrowserEngine;
  viewport?: ViewportSize;
  watchPaths?: string[];
}

export interface DaemonInfo {
  pid: number;
  socketPath: string;
  version: string;
  protocolVersion: string;
}

export interface ScreenshotResult {
  path: string;
  width: number;
  height: number;
  timestamp: string;
  base64?: string;
}

export interface DiffResult {
  baselinePath: string;
  currentPath: string;
  diffPath: string;
  mismatchedPixels: number;
  mismatchedRatio: number;
  regions: BoundingBox[];
  baselineInitialized?: boolean;
  threshold?: number;
  summary?: string;
}

export interface ExecuteParams {
  code: string;
  timeoutMs?: number;
}

export interface ExecuteResult {
  value: unknown;
}

export interface StylesParams {
  selector: string;
  props?: string[];
}

export interface DomParams {
  selector?: string;
  depth?: number;
}

export interface DescribeParams {
  selector: string;
}

export interface ContextParams {
  selector?: string;
  depth?: number;
}

export type WatchEventType = 'file_changed' | 'hmr_start' | 'hmr_complete' | 'ui_ready';

export interface WatchEvent {
  type: WatchEventType;
  ts: string;
  path?: string;
  duration_ms?: number;
}
