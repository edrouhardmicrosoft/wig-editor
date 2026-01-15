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
  type A11yResult,
  type DoctorResult,
  DEFAULT_STYLE_PROPS,
} from '@wig/canvas-core';
import { existsSync, readFileSync, unlinkSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
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

async function tryAutoStartDaemon(format: OutputFormat): Promise<boolean> {
  const { running } = isDaemonRunning();
  if (running) {
    return true;
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
    renderError(`Daemon not found at: ${daemonPath}. Run pnpm build.`, format);
    return false;
  }

  const child = spawn('node', [daemonPath], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  const startDeadlineMs = 10_000;
  const startedAt = Date.now();
  const delaysMs = [50, 100, 150, 250, 400, 600, 800, 1000, 1200, 1500, 2000];

  for (const delayMs of delaysMs) {
    try {
      const response = await withClient(async (client) => {
        return client.send<{ pong: boolean }>('ping', {});
      });
      if (isSuccessResponse(response)) {
        return true;
      }
    } catch {}

    if (Date.now() - startedAt >= startDeadlineMs) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  renderError('Failed to auto-start daemon. Run `canvas daemon start`.', format);
  return false;
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
  .option('--browser <engine>', 'Browser engine (chromium|firefox|webkit)', 'chromium')
  .option('--timeout <ms>', 'Navigation timeout in milliseconds', '30000')
  .option('--retry <count>', 'Retry failed connections', '0')
  .option('--retry-backoff <ms>', 'Retry backoff in milliseconds', '250')
  .option('--format <format>', 'Output format (text|json|yaml|ndjson)', 'text')
  .action(
    async (
      url: string,
      options: {
        format: string;
        watch: string[];
        browser: string;
        timeout: string;
        retry: string;
        retryBackoff: string;
      }
    ) => {
      const format = options.format as OutputFormat;
      const watchPaths = (options.watch ?? []).filter((p) => p.trim().length > 0);
      const browser = options.browser;
      const timeoutMs = Number(options.timeout);
      const retries = Number(options.retry);
      const backoffMs = Number(options.retryBackoff);
      if (browser !== 'chromium' && browser !== 'firefox' && browser !== 'webkit') {
        renderError('Invalid --browser. Must be chromium, firefox, or webkit.', format);
        return;
      }
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        renderError('Invalid --timeout. Must be a positive number.', format);
        return;
      }
      if (!Number.isFinite(retries) || retries < 0) {
        renderError('Invalid --retry. Must be zero or a positive number.', format);
        return;
      }
      if (!Number.isFinite(backoffMs) || backoffMs < 0) {
        renderError('Invalid --retry-backoff. Must be zero or a positive number.', format);
        return;
      }
      const params = {
        url,
        watchPaths,
        browser,
        timeoutMs,
        retries,
        backoffMs,
      };

      try {
        const response = await withClient(async (client) => {
          return client.send<SessionInfo>('connect', params);
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
          const started = await tryAutoStartDaemon(format);
          if (started) {
            try {
              const response = await withClient(async (client) => {
                return client.send<SessionInfo>('connect', params);
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
              return;
            } catch (retryErr) {
              const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
              renderError(`Failed to connect after starting daemon: ${retryMessage}`, format);
              return;
            }
          }
          renderError('Daemon is not running. Start it with: canvas daemon start', format);
        } else {
          renderError(`Failed to connect: ${message}`, format);
        }
      }
    }
  );

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
  .option('--timeout <ms>', 'Screenshot timeout in milliseconds', '30000')
  .option('--retry <count>', 'Retry failed screenshots', '0')
  .option('--retry-backoff <ms>', 'Retry backoff in milliseconds', '250')
  .option('--format <format>', 'Output format (text|json|yaml|ndjson)', 'text')
  .action(
    async (
      selector: string | undefined,
      options: {
        out?: string;
        inline?: boolean;
        format: string;
        timeout: string;
        retry: string;
        retryBackoff: string;
      }
    ) => {
      const format = options.format as OutputFormat;
      const timeoutMs = Number(options.timeout);
      const retries = Number(options.retry);
      const backoffMs = Number(options.retryBackoff);
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        renderError('Invalid --timeout. Must be a positive number.', format);
        return;
      }
      if (!Number.isFinite(retries) || retries < 0) {
        renderError('Invalid --retry. Must be zero or a positive number.', format);
        return;
      }
      if (!Number.isFinite(backoffMs) || backoffMs < 0) {
        renderError('Invalid --retry-backoff. Must be zero or a positive number.', format);
        return;
      }
      try {
        const method = selector ? 'screenshot.element' : 'screenshot.viewport';
        const params = selector
          ? { selector, out: options.out, inline: options.inline, timeoutMs, retries, backoffMs }
          : { out: options.out, inline: options.inline, timeoutMs, retries, backoffMs };

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
  .option('--timeout <ms>', 'Styles lookup timeout in milliseconds', '30000')
  .option('--retry <count>', 'Retry failed styles', '0')
  .option('--retry-backoff <ms>', 'Retry backoff in milliseconds', '250')
  .option('--format <format>', 'Output format (text|json|yaml|ndjson)', 'text')
  .action(
    async (
      selector: string,
      options: {
        props?: string;
        format: string;
        timeout: string;
        retry: string;
        retryBackoff: string;
      }
    ) => {
      const format = options.format as OutputFormat;
      const props = options.props?.split(',').map((p) => p.trim());
      const timeoutMs = Number(options.timeout);
      const retries = Number(options.retry);
      const backoffMs = Number(options.retryBackoff);
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        renderError('Invalid --timeout. Must be a positive number.', format);
        return;
      }
      if (!Number.isFinite(retries) || retries < 0) {
        renderError('Invalid --retry. Must be zero or a positive number.', format);
        return;
      }
      if (!Number.isFinite(backoffMs) || backoffMs < 0) {
        renderError('Invalid --retry-backoff. Must be zero or a positive number.', format);
        return;
      }

      try {
        const response = await withClient(async (client) => {
          return client.send<StylesResult>('styles', {
            selector,
            props,
            timeoutMs,
            retries,
            backoffMs,
          });
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
    }
  );

program
  .command('dom')
  .description('Get DOM accessibility snapshot')
  .argument('[selector]', 'CSS selector to scope the snapshot (defaults to body)')
  .option('--depth <depth>', 'Maximum depth of the tree', '5')
  .option('--timeout <ms>', 'DOM snapshot timeout in milliseconds', '30000')
  .option('--retry <count>', 'Retry failed DOM snapshots', '0')
  .option('--retry-backoff <ms>', 'Retry backoff in milliseconds', '250')
  .option('--format <format>', 'Output format (text|json|yaml|ndjson)', 'text')
  .action(
    async (
      selector: string | undefined,
      options: {
        depth: string;
        format: string;
        timeout: string;
        retry: string;
        retryBackoff: string;
      }
    ) => {
      const format = options.format as OutputFormat;
      const depth = parseInt(options.depth, 10);
      const timeoutMs = Number(options.timeout);
      const retries = Number(options.retry);
      const backoffMs = Number(options.retryBackoff);

      if (!Number.isFinite(depth) || depth < 1) {
        renderError('Invalid --depth. Must be a positive integer.', format);
        return;
      }
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        renderError('Invalid --timeout. Must be a positive number.', format);
        return;
      }
      if (!Number.isFinite(retries) || retries < 0) {
        renderError('Invalid --retry. Must be zero or a positive number.', format);
        return;
      }
      if (!Number.isFinite(backoffMs) || backoffMs < 0) {
        renderError('Invalid --retry-backoff. Must be zero or a positive number.', format);
        return;
      }

      try {
        const response = await withClient(async (client) => {
          return client.send<DomResult>('dom', {
            selector,
            depth,
            timeoutMs,
            retries,
            backoffMs,
          });
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
    }
  );

program
  .command('describe')
  .description('Get a natural language description of an element')
  .argument('<selector>', 'CSS selector for the element')
  .option('--timeout <ms>', 'Describe timeout in milliseconds', '30000')
  .option('--retry <count>', 'Retry failed descriptions', '0')
  .option('--retry-backoff <ms>', 'Retry backoff in milliseconds', '250')
  .option('--format <format>', 'Output format (text|json|yaml|ndjson)', 'text')
  .action(
    async (
      selector: string,
      options: { format: string; timeout: string; retry: string; retryBackoff: string }
    ) => {
      const format = options.format as OutputFormat;
      const timeoutMs = Number(options.timeout);
      const retries = Number(options.retry);
      const backoffMs = Number(options.retryBackoff);

      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        renderError('Invalid --timeout. Must be a positive number.', format);
        return;
      }
      if (!Number.isFinite(retries) || retries < 0) {
        renderError('Invalid --retry. Must be zero or a positive number.', format);
        return;
      }
      if (!Number.isFinite(backoffMs) || backoffMs < 0) {
        renderError('Invalid --retry-backoff. Must be zero or a positive number.', format);
        return;
      }

      try {
        const response = await withClient(async (client) => {
          return client.send<DescribeResult>('describe', {
            selector,
            timeoutMs,
            retries,
            backoffMs,
          });
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
    }
  );

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
  .option('--timeout <ms>', 'Context timeout in milliseconds', '30000')
  .option('--retry <count>', 'Retry failed context captures', '0')
  .option('--retry-backoff <ms>', 'Retry backoff in milliseconds', '250')
  .option('--format <format>', 'Output format (text|json|yaml|ndjson)', 'text')
  .action(
    async (
      selector: string | undefined,
      options: {
        depth: string;
        format: string;
        timeout: string;
        retry: string;
        retryBackoff: string;
      }
    ) => {
      const format = options.format as OutputFormat;
      const depth = parseInt(options.depth, 10);
      const timeoutMs = Number(options.timeout);
      const retries = Number(options.retry);
      const backoffMs = Number(options.retryBackoff);

      if (!Number.isFinite(depth) || depth < 1) {
        renderError('Invalid --depth. Must be a positive integer.', format);
        return;
      }
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        renderError('Invalid --timeout. Must be a positive number.', format);
        return;
      }
      if (!Number.isFinite(retries) || retries < 0) {
        renderError('Invalid --retry. Must be zero or a positive number.', format);
        return;
      }
      if (!Number.isFinite(backoffMs) || backoffMs < 0) {
        renderError('Invalid --retry-backoff. Must be zero or a positive number.', format);
        return;
      }

      try {
        const response = await withClient(async (client) => {
          return client.send<ContextResult>('context', {
            selector,
            depth,
            timeoutMs,
            retries,
            backoffMs,
          });
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
    }
  );

program
  .command('a11y')
  .description('Run accessibility checks on the page or a selector')
  .argument('[selector]', 'CSS selector to scope the scan (defaults to full page)')
  .option('--level <level>', 'WCAG level (A|AA|AAA)', 'AA')
  .option('--timeout <ms>', 'A11y timeout in milliseconds', '30000')
  .option('--retry <count>', 'Retry failed a11y scans', '0')
  .option('--retry-backoff <ms>', 'Retry backoff in milliseconds', '250')
  .option('--format <format>', 'Output format (text|json|yaml|ndjson)', 'text')
  .action(
    async (
      selector: string | undefined,
      options: {
        level: string;
        format: string;
        timeout: string;
        retry: string;
        retryBackoff: string;
      }
    ) => {
      const format = options.format as OutputFormat;
      const level = options.level;
      const timeoutMs = Number(options.timeout);
      const retries = Number(options.retry);
      const backoffMs = Number(options.retryBackoff);

      if (level !== 'A' && level !== 'AA' && level !== 'AAA') {
        renderError('Invalid --level. Must be A, AA, or AAA.', format);
        return;
      }
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        renderError('Invalid --timeout. Must be a positive number.', format);
        return;
      }
      if (!Number.isFinite(retries) || retries < 0) {
        renderError('Invalid --retry. Must be zero or a positive number.', format);
        return;
      }
      if (!Number.isFinite(backoffMs) || backoffMs < 0) {
        renderError('Invalid --retry-backoff. Must be zero or a positive number.', format);
        return;
      }

      try {
        const response = await withClient(async (client) => {
          return client.send<A11yResult>('a11y', {
            selector,
            level,
            timeoutMs,
            retries,
            backoffMs,
          });
        });

        render(response, format, (result) => {
          const total = result.violations.length;
          if (format === 'text') {
            console.log(`A11y scan (${result.level}) for: ${result.selector ?? 'page'}`);
            console.log(`URL: ${result.url}`);
            console.log(`Violations: ${String(total)}`);
            if (total > 0) {
              const first = result.violations[0];
              if (first) {
                console.log(`Top violation: ${first.id} (${first.help ?? 'no help'})`);
                const firstNode = first.nodes?.[0];
                if (firstNode?.target?.[0]) {
                  console.log(`Example node: ${firstNode.target[0]}`);
                }
              }
            }
            if (result.notes && result.notes.length > 0) {
              console.log('Notes:');
              for (const note of result.notes) {
                console.log(`- ${note}`);
              }
            }
          } else {
            console.log(`A11y scan complete: ${String(total)} violation(s)`);
          }
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('ENOENT') || message.includes('ECONNREFUSED')) {
          renderError('Daemon is not running. Start it with: canvas daemon start', format);
        } else {
          renderError(`Failed to run a11y: ${message}`, format);
        }
      }
    }
  );

program
  .command('doctor')
  .description('Run diagnostics on daemon connectivity and browser readiness')
  .option('--format <format>', 'Output format (text|json|yaml|ndjson)', 'text')
  .action(async (options: { format: string }) => {
    const format = options.format as OutputFormat;
    try {
      const response = await withClient(async (client) => {
        return client.send<DoctorResult>('doctor', {});
      });

      render(response, format, (result) => {
        if (format === 'text') {
          console.log(`Doctor: ${result.ok ? 'OK' : 'FAIL'}`);
          console.log(`Endpoint: ${result.endpoint}`);
          console.log(`Transport: ${result.transport}`);
          for (const check of result.checks) {
            console.log(`- ${check.ok ? 'ok' : 'fail'}: ${check.label}`);
            if (check.detail) {
              console.log(`  ${check.detail}`);
            }
            if (check.suggestion) {
              console.log(`  Suggestion: ${check.suggestion}`);
            }
          }
          if (result.lastError) {
            console.log('Last error:');
            console.log(`  ${result.lastError.message}`);
            if (result.lastError.data.suggestion) {
              console.log(`  Suggestion: ${result.lastError.data.suggestion}`);
            }
          }
        } else {
          console.log(`Doctor complete: ${result.ok ? 'ok' : 'fail'}`);
        }

        if (!result.ok) {
          process.exit(1);
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('ENOENT') || message.includes('ECONNREFUSED')) {
        renderError('Daemon is not running. Start it with: canvas daemon start', format);
      } else {
        renderError(`Failed to run doctor: ${message}`, format);
      }
    }
  });

program
  .command('clean')
  .description('Remove .canvas artifacts (screenshots, diffs, manifests)')
  .option('--keep-baseline', 'Keep baseline assets', false)
  .option('--format <format>', 'Output format (text|json|yaml|ndjson)', 'text')
  .action(async (options: { keepBaseline: boolean; format: string }) => {
    const format = options.format as OutputFormat;
    const cwd = process.cwd();
    const canvasDir = join(cwd, '.canvas');
    const screenshotsDir = join(canvasDir, 'screenshots');
    const diffsDir = join(canvasDir, 'diffs');

    if (!existsSync(canvasDir)) {
      if (format === 'json') {
        console.log(
          JSON.stringify({ ok: true, result: { removed: false, path: canvasDir } }, null, 2)
        );
      } else if (format === 'yaml') {
        console.log(
          JSON.stringify({ ok: true, result: { removed: false, path: canvasDir } }, null, 2)
        );
      } else if (format === 'ndjson') {
        console.log(JSON.stringify({ ok: true, result: { removed: false, path: canvasDir } }));
      } else {
        console.log('No .canvas directory found');
      }

      return;
    }

    try {
      if (existsSync(screenshotsDir)) {
        if (options.keepBaseline) {
          const baselinePath = join(screenshotsDir, 'baseline.png');
          const baselineExists = existsSync(baselinePath);
          if (baselineExists) {
            const tmpDir = join(cwd, '.canvas_tmp');
            mkdirSync(tmpDir, { recursive: true });
            const tmpBaseline = join(tmpDir, 'baseline.png');
            writeFileSync(tmpBaseline, readFileSync(baselinePath));
            rmSync(screenshotsDir, { recursive: true, force: true });
            mkdirSync(screenshotsDir, { recursive: true });
            writeFileSync(join(screenshotsDir, 'baseline.png'), readFileSync(tmpBaseline));
            rmSync(tmpDir, { recursive: true, force: true });
          } else {
            rmSync(screenshotsDir, { recursive: true, force: true });
            mkdirSync(screenshotsDir, { recursive: true });
          }
        } else {
          rmSync(screenshotsDir, { recursive: true, force: true });
        }
      }

      if (existsSync(diffsDir)) {
        if (options.keepBaseline) {
          const baselineMarker = join(diffsDir, 'baseline.json');
          const manifest = join(diffsDir, 'manifest.jsonl');
          const baselineMarkerExists = existsSync(baselineMarker);
          const manifestExists = existsSync(manifest);
          if (baselineMarkerExists || manifestExists) {
            const tmpDir = join(cwd, '.canvas_tmp');
            mkdirSync(tmpDir, { recursive: true });
            if (baselineMarkerExists) {
              writeFileSync(join(tmpDir, 'baseline.json'), readFileSync(baselineMarker));
            }
            if (manifestExists) {
              writeFileSync(join(tmpDir, 'manifest.jsonl'), readFileSync(manifest));
            }
            rmSync(diffsDir, { recursive: true, force: true });
            mkdirSync(diffsDir, { recursive: true });
            if (baselineMarkerExists) {
              writeFileSync(
                join(diffsDir, 'baseline.json'),
                readFileSync(join(tmpDir, 'baseline.json'))
              );
            }
            if (manifestExists) {
              writeFileSync(
                join(diffsDir, 'manifest.jsonl'),
                readFileSync(join(tmpDir, 'manifest.jsonl'))
              );
            }
            rmSync(tmpDir, { recursive: true, force: true });
          } else {
            rmSync(diffsDir, { recursive: true, force: true });
            mkdirSync(diffsDir, { recursive: true });
          }
        } else {
          rmSync(diffsDir, { recursive: true, force: true });
        }
      }

      if (!options.keepBaseline) {
        rmSync(canvasDir, { recursive: true, force: true });
      }

      if (format === 'json') {
        console.log(
          JSON.stringify({ ok: true, result: { removed: true, path: canvasDir } }, null, 2)
        );
      } else if (format === 'yaml') {
        console.log(
          JSON.stringify({ ok: true, result: { removed: true, path: canvasDir } }, null, 2)
        );
      } else if (format === 'ndjson') {
        console.log(JSON.stringify({ ok: true, result: { removed: true, path: canvasDir } }));
      } else {
        console.log(`Cleaned ${canvasDir}`);
        if (options.keepBaseline) {
          console.log('Baseline assets preserved.');
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      renderError(`Failed to clean .canvas: ${message}`, format);
    }
  });

program.parse();
