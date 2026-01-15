#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { PROTOCOL_VERSION, DAEMON_VERSION } from '@wig/canvas-core';
import { DaemonServer } from './server/index.js';

const { values } = parseArgs({
  options: {
    help: { type: 'boolean', short: 'h' },
    version: { type: 'boolean', short: 'v' },
  },
  strict: false,
  allowPositionals: true,
});

if (values.help) {
  console.log(`canvasd - WIG Canvas daemon process

Usage: canvasd [options]

Options:
  -h, --help      Show this help message
  -v, --version   Show version information

The daemon manages browser lifecycle and serves RPC requests
over a local Unix socket (macOS/Linux) or named pipe (Windows).`);
  process.exit(0);
}

if (values.version) {
  console.log(`canvasd ${DAEMON_VERSION}`);
  console.log(`protocol ${PROTOCOL_VERSION}`);
  process.exit(0);
}

console.error(`canvasd ${DAEMON_VERSION} starting...`);

const server = new DaemonServer();

const FORCE_SHUTDOWN_TIMEOUT_MS = 10_000;

const shutdown = (signal: string) => {
  console.error(`Received ${signal}, shutting down...`);

  const timeout = setTimeout(() => {
    console.error('Shutdown timed out; forcing exit.');
    process.exit(1);
  }, FORCE_SHUTDOWN_TIMEOUT_MS);

  void server
    .stop()
    .then(() => {
      clearTimeout(timeout);
      process.exit(0);
    })
    .catch((err: unknown) => {
      clearTimeout(timeout);
      const message = err instanceof Error ? err.message : String(err);
      console.error('Shutdown failed:', message);
      process.exit(1);
    });
};

process.on('SIGINT', () => {
  shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM');
});

server.start().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('Failed to start daemon:', message);
  process.exit(1);
});
