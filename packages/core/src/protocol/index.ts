export type RequestId = `req_${string}`;

export type OutputFormat = 'text' | 'json' | 'yaml' | 'ndjson';

export interface ClientInfo {
  name: string;
  version: string;
}

export interface RequestMeta {
  cwd: string;
  format: OutputFormat;
  protocolVersion: string;
  client: ClientInfo;
}

export type MethodName =
  | 'ping'
  | 'daemon.status'
  | 'daemon.stop'
  | 'connect'
  | 'disconnect'
  | 'status'
  | 'screenshot.viewport'
  | 'screenshot.element'
  | 'execute'
  | 'describe'
  | 'dom'
  | 'styles'
  | 'context'
  | 'a11y'
  | 'diff'
  | 'watch.subscribe'
  | 'watch.unsubscribe'
  | 'watch.configure'
  | 'viewer.start'
  | 'viewer.stop'
  | 'viewer.status'
  | 'doctor';

export interface Request<P = unknown> {
  id: RequestId;
  method: MethodName;
  params: P;
  meta: RequestMeta;
}

export interface SuccessResponse<R = unknown> {
  id: RequestId;
  ok: true;
  result: R;
}

export interface ErrorData {
  category: string;
  retryable: boolean;
  param?: string;
  suggestion?: string;
}

export interface ErrorInfo {
  code: number;
  message: string;
  data: ErrorData;
}

export interface ErrorResponse {
  id: RequestId;
  ok: false;
  error: ErrorInfo;
}

export type Response<R = unknown> = SuccessResponse<R> | ErrorResponse;

export function generateRequestId(): RequestId {
  const timestamp = String(Date.now());
  const random = Math.random().toString(36).slice(2, 8);
  return `req_${timestamp}_${random}`;
}

export function isSuccessResponse<R>(response: Response<R>): response is SuccessResponse<R> {
  return response.ok;
}

export function isErrorResponse(response: Response): response is ErrorResponse {
  return !response.ok;
}
