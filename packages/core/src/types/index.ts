import type { ErrorInfo } from '../protocol/index.js';

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

export interface DoctorCheck {
  id: string;
  label: string;
  ok: boolean;
  detail?: string;
  suggestion?: string;
}

export interface DoctorBrowserCheck {
  engine: BrowserEngine;
  executablePath: string;
  installed: boolean;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
  endpoint: string;
  transport: TransportType;
  browsers?: DoctorBrowserCheck[];
  lastError?: ErrorInfo;
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

export interface RetryOptions {
  retries?: number;
  backoffMs?: number;
}

export interface ExecuteResult {
  value: unknown;
}

export interface StylesParams {
  selector: string;
  props?: string[];
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
}

export interface DomParams {
  selector?: string;
  depth?: number;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
}

export interface DescribeParams {
  selector: string;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
}

export interface ContextParams {
  selector?: string;
  depth?: number;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
}

export type A11yLevel = 'A' | 'AA' | 'AAA';

export interface A11yParams {
  selector?: string;
  level?: A11yLevel;
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
}

export interface A11yNodeResult {
  html?: string;
  target?: string[];
  failureSummary?: string;
}

export interface A11yViolation {
  id: string;
  impact?: string;
  tags?: string[];
  description?: string;
  help?: string;
  helpUrl?: string;
  nodes?: A11yNodeResult[];
}

export interface A11yResult {
  url: string;
  selector?: string;
  level: A11yLevel;
  timestamp?: string;
  browser?: BrowserEngine;
  notes?: string[];
  violations: A11yViolation[];
  passes?: A11yViolation[];
  incomplete?: A11yViolation[];
  inapplicable?: A11yViolation[];
}

export type WatchEventType =
  | 'file_changed'
  | 'hmr_start'
  | 'hmr_complete'
  | 'ui_changed'
  | 'ui_ready'
  | 'screenshot'
  | 'navigation';

export interface WatchEvent {
  type: WatchEventType;
  ts: string;
  path?: string;
  duration_ms?: number;
  url?: string;
  screenshot?: ScreenshotResult;
}

export interface ViewerStatus {
  running: boolean;
  port?: number;
  url?: string;
  browser?: BrowserEngine;
  error?: string;
}
