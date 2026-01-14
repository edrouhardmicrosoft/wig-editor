import type { CanvasError } from '../errors/index.js';

export type { OutputFormat } from '../protocol/index.js';

/**
 * Base result envelope for successful responses.
 * All CLI commands should return data wrapped in this envelope.
 */
export interface SuccessEnvelope<T = unknown> {
  ok: true;
  result: T;
}

/**
 * Error envelope for failed responses.
 * Contains structured error information.
 */
export interface ErrorEnvelope {
  ok: false;
  error: CanvasError;
}

/**
 * Union type for all result envelopes.
 */
export type ResultEnvelope<T = unknown> = SuccessEnvelope<T> | ErrorEnvelope;

/**
 * Type guard for success envelopes.
 */
export function isSuccessEnvelope<T>(envelope: ResultEnvelope<T>): envelope is SuccessEnvelope<T> {
  return envelope.ok === true;
}

/**
 * Type guard for error envelopes.
 */
export function isErrorEnvelope(envelope: ResultEnvelope): envelope is ErrorEnvelope {
  return envelope.ok === false;
}

/**
 * Create a success envelope.
 */
export function success<T>(result: T): SuccessEnvelope<T> {
  return { ok: true, result };
}

/**
 * Create an error envelope.
 */
export function failure(error: CanvasError): ErrorEnvelope {
  return { ok: false, error };
}

/**
 * DOM snapshot node structure.
 * Represents an element in the accessibility tree.
 */
export interface DomNode {
  /** Accessibility role (e.g., 'button', 'link', 'heading') */
  role: string;
  /** Accessible name if present */
  name?: string;
  /** Element tag name in lowercase */
  tag?: string;
  /** CSS selector that can locate this element */
  selector?: string;
  /** Bounding box coordinates relative to viewport */
  box?: BoundingBoxOutput;
  /** Whether the element is visible */
  visible?: boolean;
  /** Whether the element is disabled */
  disabled?: boolean;
  /** ARIA level for headings */
  level?: number;
  /** Child nodes (depth-limited) */
  children?: DomNode[];
}

/**
 * Bounding box output shape.
 */
export interface BoundingBoxOutput {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Styles result shape.
 */
export interface StylesResult {
  selector: string;
  url: string;
  props: Record<string, string>;
}

/**
 * DOM snapshot result shape.
 */
export interface DomResult {
  selector?: string;
  url: string;
  depth: number;
  root: DomNode;
  yaml: string;
}

/**
 * Describe result shape (natural language + structured data).
 */
export interface DescribeResult {
  selector: string;
  url: string;
  summary: string;
  role: string;
  name?: string;
  box: BoundingBoxOutput;
  visible: boolean;
  disabled: boolean;
  styles: Record<string, string>;
  children: Array<{
    role: string;
    name?: string;
    tag?: string;
  }>;
}

/**
 * Screenshot result with optional inline base64.
 */
export interface ScreenshotOutput {
  path: string;
  width: number;
  height: number;
  timestamp: string;
  /** Base64-encoded PNG bytes (only present if --inline flag is used) */
  base64?: string;
}

/**
 * Context command result bundling multiple inspection results.
 */
export interface ContextResult {
  selector?: string;
  url: string;
  screenshot: ScreenshotOutput;
  describe: DescribeResult;
  dom: DomResult;
  styles: StylesResult;
}

/**
 * Default set of CSS properties returned by the styles command.
 */
export const DEFAULT_STYLE_PROPS = [
  'display',
  'position',
  'width',
  'height',
  'margin',
  'padding',
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'border',
  'border-radius',
  'opacity',
  'visibility',
  'overflow',
  'z-index',
] as const;

export type DefaultStyleProp = (typeof DEFAULT_STYLE_PROPS)[number];
