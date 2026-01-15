#!/usr/bin/env node
import { Command } from 'commander';
import {
  getTransportConfig,
  getSocketPath,
  getPidFilePath,
  isSuccessResponse,
  type DaemonInfo,
  type SessionInfo,
  type ScreenshotResult,
  type DiffResult,
  type OutputFormat,
  type StylesResult,
  type DomResult,
  type DescribeResult,
  type ContextResult,
  DEFAULT_STYLE_PROPS,
} from '@wig/canvas-core';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { withClient } from './client/index.js';
import { render, renderError } from './output/index.js';

const VERSION = '0.0.0';

const program = new Command();

program
  .name('canvas')
  .description('CLI-first canvas toolkit for browser automation')
  .version(VERSION);

const daemonCmd = program.command('daemon').description('Manage the canvas daemon process');

function collectString(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function isDaemonRunning(): { running: boolean; pid: number | null } {
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

daemonCmd
  .command('status')
  .description('Show daemon status and endpoint info')
  .option('--format <format>', 'Output format (text|json)', 'text')
  .action(async (options: { format: string }) => {
    const transport = getTransportConfig();
    const socketPath = getSocketPath();
    const { running, pid } = isDaemonRunning();

    let daemonInfo: DaemonInfo | null = null;
    if (running) {
      try {
        const response = await withClient(async (client) => {
          return client.send<DaemonInfo>('daemon.status', {});
        });
        if (isSuccessResponse(response)) {
          daemonInfo = response.result;
        }
      } catch {
        daemonInfo = null;
      }
    }

    const status = {
      running,
      pid: daemonInfo?.pid ?? pid,
      transport: transport.type,
      endpoint: socketPath,
      socketExists: transport.type === 'unix' ? existsSync(socketPath) : null,
      version: daemonInfo?.version ?? null,
      protocolVersion: daemonInfo?.protocolVersion ?? null,
    };

    if (options.format === 'json') {
      console.log(JSON.stringify(status, null, 2));
    } else {
      console.log('Daemon Status');
      console.log(`  Running:          ${running ? 'yes' : 'no'}`);
      if (status.pid) {
        console.log(`  PID:              ${String(status.pid)}`);
      }
      console.log(`  Transport:        ${transport.type}`);
      console.log(`  Endpoint:         ${socketPath}`);
      if (transport.type === 'unix') {
        console.log(`  Socket:           ${existsSync(socketPath) ? 'exists' : 'not found'}`);
      }
      if (status.version) {
        console.log(`  Version:          ${status.version}`);
      }
      if (status.protocolVersion) {
        console.log(`  Protocol Version: ${status.protocolVersion}`);
      }
    }
  });

daemonCmd
  .command('start')
  .description('Start the daemon process')
  .option('--foreground', 'Run in foreground (do not daemonize)', false)
  .action(async (options: { foreground: boolean }) => {
    const { running, pid } = isDaemonRunning();
    if (running) {
      console.error(`Daemon already running (PID: ${String(pid)})`);
      process.exit(1);
    }

    const socketPath = getSocketPath();
    const pidFile = getPidFilePath();
    if (existsSync(socketPath)) {
      unlinkSync(socketPath);
    }
    if (existsSync(pidFile)) {
      unlinkSync(pidFile);
    }

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const daemonPath = resolve(__dirname, '../../daemon/dist/index.js');

    if (!existsSync(daemonPath)) {
      console.error(`Daemon not found at: ${daemonPath}`);
      console.error('Run `pnpm build` to build the daemon.');
      process.exit(1);
    }

    if (options.foreground) {
      const { execSync } = await import('node:child_process');
      try {
        execSync(`node "${daemonPath}"`, { stdio: 'inherit' });
      } catch {
        process.exit(1);
      }
    } else {
      const child = spawn('node', [daemonPath], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();

      const startDeadlineMs = 10_000;
      const startedAt = Date.now();
      let lastErrorMessage: string | null = null;

      const delaysMs = [50, 100, 150, 250, 400, 600, 800, 1000, 1200, 1500, 2000];

      for (const delayMs of delaysMs) {
        try {
          const response = await withClient(async (client) => {
            return client.send<{ pong: boolean }>('ping', {});
          });

          if (isSuccessResponse(response)) {
            const { pid: newPid } = isDaemonRunning();
            console.log(`Daemon started (PID: ${String(newPid ?? 'unknown')})`);
            return;
          }

          lastErrorMessage = response.error.message;
        } catch (err) {
          lastErrorMessage = err instanceof Error ? err.message : String(err);
        }

        if (Date.now() - startedAt >= startDeadlineMs) {
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }

      const elapsedMs = Date.now() - startedAt;
      console.error(
        `Failed to start daemon: did not become ready within ${String(startDeadlineMs)}ms (waited ${String(
          elapsedMs
        )}ms).${lastErrorMessage ? ` Last error: ${lastErrorMessage}` : ''}`
      );
      process.exit(1);
    }
  });

daemonCmd
  .command('stop')
  .description('Stop the daemon process')
  .action(async () => {
    const { running, pid } = isDaemonRunning();
    if (!running) {
      console.log('Daemon is not running');
      return;
    }

    try {
      const response = await withClient(async (client) => {
        return client.send<{ stopping: boolean }>('daemon.stop', {});
      });

      if (isSuccessResponse(response)) {
        console.log(`Daemon stopping (PID: ${String(pid)})`);
        await new Promise((resolve) => setTimeout(resolve, 500));
      } else {
        console.error(`Error: ${response.error.message}`);
        process.exit(1);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ENOENT') || message.includes('ECONNREFUSED')) {
        if (pid) {
          try {
            process.kill(pid, 'SIGTERM');
            console.log(`Sent SIGTERM to daemon (PID: ${String(pid)})`);
          } catch {
            console.error('Failed to stop daemon');
            process.exit(1);
          }
        }
      } else {
        console.error(`Failed to connect: ${message}`);
        process.exit(1);
      }
    }
  });

daemonCmd
  .command('ping')
  .description('Ping the daemon to verify connectivity')
  .option('--format <format>', 'Output format (text|json|yaml|ndjson)', 'text')
  .action(async (options: { format: string }) => {
    const format = options.format as OutputFormat;
    try {
      const response = await withClient(async (client) => {
        return client.send<{ pong: boolean }>('ping', {});
      });
      render(response, format, () => {
        console.log('pong');
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ENOENT') || message.includes('ECONNREFUSED')) {
        renderError('Daemon is not running. Start it with: canvas daemon start', format);
      } else {
        renderError(`Failed to connect: ${message}`, format);
      }
    }
  });

program
  .command('connect')
  .description('Connect to a URL and open a browser session')
  .argument('<url>', 'URL to connect to')
  .option(
    '--watch <path>',
    'Watch a directory for changes (may be specified multiple times)',
    collectString,
    []
  )
  .option('--format <format>', 'Output format (text|json|yaml|ndjson)', 'text')
  .action(async (url: string, options: { format: string; watch: string[] }) => {
    const format = options.format as OutputFormat;
    const watchPaths = (options.watch ?? []).filter((p) => p.trim().length > 0);
    try {
      const response = await withClient(async (client) => {
        return client.send<SessionInfo>('connect', { url, watchPaths });
      });
      render(response, format, (result) => {
        console.log(`Connected to: ${result.url ?? url}`);
        console.log(`  Browser:  ${result.browser ?? 'unknown'}`);
        if (result.viewport) {
          console.log(
            `  Viewport: ${String(result.viewport.width)}x${String(result.viewport.height)}`
          );
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ENOENT') || message.includes('ECONNREFUSED')) {
        renderError('Daemon is not running. Start it with: canvas daemon start', format);
      } else {
        renderError(`Failed to connect: ${message}`, format);
      }
    }
  });

program
  .command('disconnect')
  .description('Disconnect from the current browser session')
  .option('--format <format>', 'Output format (text|json|yaml|ndjson)', 'text')
  .action(async (options: { format: string }) => {
    const format = options.format as OutputFormat;
    try {
      const response = await withClient(async (client) => {
        return client.send<{ disconnected: boolean }>('disconnect', {});
      });
      render(response, format, () => {
        console.log('Disconnected');
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ENOENT') || message.includes('ECONNREFUSED')) {
        renderError('Daemon is not running. Start it with: canvas daemon start', format);
      } else {
        renderError(`Failed to disconnect: ${message}`, format);
      }
    }
  });

program
  .command('status')
  .description('Show current session status')
  .option('--format <format>', 'Output format (text|json|yaml|ndjson)', 'text')
  .action(async (options: { format: string }) => {
    const format = options.format as OutputFormat;
    try {
      const response = await withClient(async (client) => {
        return client.send<SessionInfo>('status', {});
      });
      render(response, format, (session) => {
        console.log('Session Status');
        console.log(`  Connected: ${session.connected ? 'yes' : 'no'}`);
        if (session.url) {
          console.log(`  URL:       ${session.url}`);
        }
        if (session.browser) {
          console.log(`  Browser:   ${session.browser}`);
        }
        if (session.viewport) {
          console.log(
            `  Viewport:  ${String(session.viewport.width)}x${String(session.viewport.height)}`
          );
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ENOENT') || message.includes('ECONNREFUSED')) {
        renderError('Daemon is not running. Start it with: canvas daemon start', format);
      } else {
        renderError(`Failed to get status: ${message}`, format);
      }
    }
  });

program
  .command('execute')
  .description(
    'Execute JavaScript in the connected page context (DANGEROUS: arbitrary code execution)'
  )
  .argument('<code>', 'JavaScript source code to run')
  .option('--timeout-ms <ms>', 'Execution timeout in milliseconds', '5000')
  .option('--format <format>', 'Output format (text|json|yaml|ndjson)', 'text')
  .action(async (code: string, options: { timeoutMs: string; format: string }) => {
    const timeoutMs = Number(options.timeoutMs);
    const format = options.format as OutputFormat;

    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      renderError('Invalid --timeout-ms. Must be a positive number.', format);
      return;
    }

    try {
      const response = await withClient(async (client) => {
        return client.send<{ value: unknown }>('execute', { code, timeoutMs });
      });
      render(response, format, (result) => {
        if (typeof result.value === 'string') {
          console.log(result.value);
        } else {
          console.log(JSON.stringify(result.value, null, 2));
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ENOENT') || message.includes('ECONNREFUSED')) {
        renderError('Daemon is not running. Start it with: canvas daemon start', format);
      } else {
        renderError(`Failed to execute: ${message}`, format);
      }
    }
  });

program
  .command('diff')
  .description('Compare the current screenshot against a baseline and output a visual diff')
  .argument('[selector]', 'CSS selector for element diff (viewport if omitted)')
  .option('--since <since>', 'Baseline selector: "last" or ISO timestamp')
  .option('--threshold <threshold>', 'Diff threshold (0..1). Higher ignores more noise', '0.1')
  .option('--format <format>', 'Output format (text|json|yaml|ndjson)', 'text')
  .action(
    async (
      selector: string | undefined,
      options: { since?: string; threshold: string; format: string }
    ) => {
      const format = options.format as OutputFormat;
      const threshold = Number(options.threshold);

      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
        renderError('Invalid --threshold. Must be a number between 0 and 1.', format);
        return;
      }

      try {
        const response = await withClient(async (client) => {
          return client.send<DiffResult>('diff', {
            selector,
            since: options.since,
            threshold,
          });
        });

        render(response, format, (result) => {
          const ratioPct = (result.mismatchedRatio * 100).toFixed(2);
          console.log(`Baseline: ${result.baselinePath}`);
          console.log(`Current:  ${result.currentPath}`);
          console.log(`Diff:     ${result.diffPath}`);
          if (result.baselineInitialized) {
            console.log('Baseline initialized (no prior baseline existed).');
          }
          console.log(`Mismatched: ${String(result.mismatchedPixels)} pixels (${ratioPct}%)`);
          console.log(`Regions: ${String(result.regions.length)}`);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('ENOENT') || message.includes('ECONNREFUSED')) {
          renderError('Daemon is not running. Start it with: canvas daemon start', format);
        } else {
          renderError(`Failed to diff: ${message}`, format);
        }
      }
    }
  );

program
  .command('screenshot')
  .description('Take a screenshot of the viewport or an element')
  .argument('[selector]', 'CSS selector for element screenshot (viewport if omitted)')
  .option('--out <path>', 'Output path for the screenshot')
  .option('--inline', 'Include base64-encoded PNG in JSON output')
  .option('--format <format>', 'Output format (text|json|yaml|ndjson)', 'text')
  .action(
    async (
      selector: string | undefined,
      options: { out?: string; inline?: boolean; format: string }
    ) => {
      const format = options.format as OutputFormat;
      try {
        const method = selector ? 'screenshot.element' : 'screenshot.viewport';
        const params = selector
          ? { selector, out: options.out, inline: options.inline }
          : { out: options.out, inline: options.inline };

        const response = await withClient(async (client) => {
          return client.send<ScreenshotResult>(method, params);
        });
        render(response, format, (result) => {
          console.log(`Screenshot saved to: ${result.path}`);
          console.log(`  Size: ${String(result.width)}x${String(result.height)}`);
          if (result.base64) {
            console.log(
              `  Base64: ${result.base64.slice(0, 50)}... (${result.base64.length} chars)`
            );
          }
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('ENOENT') || message.includes('ECONNREFUSED')) {
          renderError('Daemon is not running. Start it with: canvas daemon start', format);
        } else {
          renderError(`Failed to take screenshot: ${message}`, format);
        }
      }
    }
  );

program
  .command('styles')
  .description('Get computed styles for an element')
  .argument('<selector>', 'CSS selector for the element')
  .option('--props <props>', 'Comma-separated list of CSS properties to retrieve')
  .option('--format <format>', 'Output format (text|json|yaml|ndjson)', 'text')
  .action(async (selector: string, options: { props?: string; format: string }) => {
    const format = options.format as OutputFormat;
    const props = options.props?.split(',').map((p) => p.trim());

    try {
      const response = await withClient(async (client) => {
        return client.send<StylesResult>('styles', { selector, props });
      });
      render(response, format, (result) => {
        console.log(`Styles for: ${result.selector}`);
        console.log(`URL: ${result.url}`);
        console.log('');
        const propNames = props ?? [...DEFAULT_STYLE_PROPS];
        for (const prop of propNames) {
          const value = result.props[prop];
          if (value !== undefined) {
            console.log(`  ${prop}: ${value}`);
          }
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ENOENT') || message.includes('ECONNREFUSED')) {
        renderError('Daemon is not running. Start it with: canvas daemon start', format);
      } else {
        renderError(`Failed to get styles: ${message}`, format);
      }
    }
  });

program
  .command('dom')
  .description('Get DOM accessibility snapshot')
  .argument('[selector]', 'CSS selector to scope the snapshot (defaults to body)')
  .option('--depth <depth>', 'Maximum depth of the tree', '5')
  .option('--format <format>', 'Output format (text|json|yaml|ndjson)', 'text')
  .action(async (selector: string | undefined, options: { depth: string; format: string }) => {
    const format = options.format as OutputFormat;
    const depth = parseInt(options.depth, 10);

    if (!Number.isFinite(depth) || depth < 1) {
      renderError('Invalid --depth. Must be a positive integer.', format);
      return;
    }

    try {
      const response = await withClient(async (client) => {
        return client.send<DomResult>('dom', { selector, depth });
      });
      render(response, format, (result) => {
        if (format === 'text') {
          console.log(result.yaml);
        } else {
          console.log(`DOM snapshot for: ${result.selector ?? 'body'}`);
          console.log(`URL: ${result.url}`);
          console.log(`Depth: ${String(result.depth)}`);
          console.log('');
          console.log(result.yaml);
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ENOENT') || message.includes('ECONNREFUSED')) {
        renderError('Daemon is not running. Start it with: canvas daemon start', format);
      } else {
        renderError(`Failed to get DOM: ${message}`, format);
      }
    }
  });

program
  .command('describe')
  .description('Get a natural language description of an element')
  .argument('<selector>', 'CSS selector for the element')
  .option('--format <format>', 'Output format (text|json|yaml|ndjson)', 'text')
  .action(async (selector: string, options: { format: string }) => {
    const format = options.format as OutputFormat;

    try {
      const response = await withClient(async (client) => {
        return client.send<DescribeResult>('describe', { selector });
      });
      render(response, format, (result) => {
        if (format === 'text') {
          console.log(result.summary);
        } else {
          console.log(`Description for: ${result.selector}`);
          console.log(`URL: ${result.url}`);
          console.log('');
          console.log(result.summary);
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ENOENT') || message.includes('ECONNREFUSED')) {
        renderError('Daemon is not running. Start it with: canvas daemon start', format);
      } else {
        renderError(`Failed to describe: ${message}`, format);
      }
    }
  });

program
  .command('watch')
  .description('Stream daemon watch events')
  .option('--format <format>', 'Output format (ndjson)', 'ndjson')
  .action(async (options: { format: string }) => {
    const format = options.format as OutputFormat;
    if (format !== 'ndjson') {
      renderError('watch only supports --format ndjson', format);
      return;
    }

    try {
      await withClient(async (client) => {
        const response = await client.send<{ subscriberId: string }>('watch.subscribe', {});
        if (!isSuccessResponse(response)) {
          render(response, format, () => {});
          return;
        }

        const subscriberId = response.result.subscriberId;

        let shuttingDown = false;
        const shutdown = async (): Promise<void> => {
          if (shuttingDown) return;
          shuttingDown = true;
          try {
            await client.send('watch.unsubscribe', { subscriberId });
          } catch {}
          process.exit(0);
        };

        process.on('SIGINT', () => {
          void shutdown();
        });

        client.onLine((msg: string) => {
          try {
            const parsed = JSON.parse(msg) as { ok?: unknown; id?: unknown };
            if (
              parsed &&
              typeof parsed === 'object' &&
              typeof parsed.ok === 'boolean' &&
              typeof parsed.id === 'string'
            ) {
              return;
            }
          } catch {}
          process.stdout.write(msg + '\n');
        });

        await new Promise(() => {});
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ENOENT') || message.includes('ECONNREFUSED')) {
        renderError('Daemon is not running. Start it with: canvas daemon start', format);
      } else {
        renderError(`Failed to watch: ${message}`, format);
      }
    }
  });

program
  .command('context')
  .description('Get full inspection context for an element (screenshot, describe, dom, styles)')
  .argument('[selector]', 'CSS selector for the element (defaults to body)')
  .option('--depth <depth>', 'Maximum depth for DOM tree', '5')
  .option('--format <format>', 'Output format (text|json|yaml|ndjson)', 'text')
  .action(async (selector: string | undefined, options: { depth: string; format: string }) => {
    const format = options.format as OutputFormat;
    const depth = parseInt(options.depth, 10);

    if (!Number.isFinite(depth) || depth < 1) {
      renderError('Invalid --depth. Must be a positive integer.', format);
      return;
    }

    try {
      const response = await withClient(async (client) => {
        return client.send<ContextResult>('context', { selector, depth });
      });
      render(response, format, (result) => {
        if (format === 'text') {
          console.log('Context for:', result.selector ?? 'body');
          console.log('URL:', result.url);
          console.log('');
          console.log('=== Screenshot ===');
          console.log(`Path: ${result.screenshot.path}`);
          console.log(
            `Size: ${String(result.screenshot.width)}x${String(result.screenshot.height)}`
          );
          console.log('');
          console.log('=== Description ===');
          console.log(result.describe.summary);
          console.log('');
          console.log('=== DOM ===');
          console.log(result.dom.yaml);
          console.log('');
          console.log('=== Key Styles ===');
          for (const [prop, value] of Object.entries(result.styles.props).slice(0, 6)) {
            console.log(`  ${prop}: ${value}`);
          }
        } else {
          console.log('Context for:', result.selector ?? 'body');
          console.log('URL:', result.url);
          console.log('Screenshot:', result.screenshot.path);
          console.log('Description:', result.describe.summary);
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ENOENT') || message.includes('ECONNREFUSED')) {
        renderError('Daemon is not running. Start it with: canvas daemon start', format);
      } else {
        renderError(`Failed to get context: ${message}`, format);
      }
    }
  });

program.parse();
