import { createConnection, type Socket } from 'node:net';
import {
  type Request,
  type Response,
  type MethodName,
  generateRequestId,
  getSocketPath,
  CLI_VERSION,
  PROTOCOL_VERSION,
} from '@wig/canvas-core';

export class DaemonClient {
  private socket: Socket | null = null;
  private lineListeners: Array<(line: string) => void> = [];
  private socketPath: string;
  private pendingRequests: Map<
    string,
    {
      resolve: (response: Response) => void;
      reject: (error: Error) => void;
    }
  > = new Map();
  private buffer = '';

  constructor() {
    this.socketPath = getSocketPath();
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = createConnection(this.socketPath);

      this.socket.on('connect', () => {
        resolve();
      });

      this.socket.on('error', (err) => {
        reject(err);
      });

      this.socket.on('data', (data) => {
        this.buffer += data.toString();

        let newlineIndex: number;
        while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
          const line = this.buffer.slice(0, newlineIndex);
          this.buffer = this.buffer.slice(newlineIndex + 1);

          if (line.trim()) {
            this.handleResponse(line);
          }
        }
      });

      this.socket.on('close', () => {
        for (const { reject: rej } of this.pendingRequests.values()) {
          rej(new Error('Connection closed'));
        }
        this.pendingRequests.clear();
      });
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
  }

  async send<R>(method: MethodName, params: unknown): Promise<Response<R>> {
    if (!this.socket) {
      throw new Error('Not connected');
    }

    const request: Request = {
      id: generateRequestId(),
      method,
      params,
      meta: {
        cwd: process.cwd(),
        format: 'json',
        protocolVersion: PROTOCOL_VERSION,
        client: {
          name: 'canvas',
          version: CLI_VERSION,
        },
      },
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(request.id, {
        resolve: resolve as (response: Response) => void,
        reject,
      });

      const json = JSON.stringify(request) + '\n';
      this.socket?.write(json);
    });
  }

  onLine(listener: (line: string) => void): void {
    this.lineListeners.push(listener);
  }

  private handleResponse(line: string): void {
    for (const listener of this.lineListeners) {
      try {
        listener(line);
      } catch {}
    }

    try {
      const response = JSON.parse(line) as Response;
      const pending = this.pendingRequests.get(response.id);

      if (pending) {
        this.pendingRequests.delete(response.id);
        pending.resolve(response);
      }
    } catch {
      console.error('Failed to parse response:', line);
    }
  }
}

export async function withClient<T>(fn: (client: DaemonClient) => Promise<T>): Promise<T> {
  const client = new DaemonClient();
  await client.connect();
  try {
    return await fn(client);
  } finally {
    client.disconnect();
  }
}
