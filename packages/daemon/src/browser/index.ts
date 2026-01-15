import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';
import {
  mkdirSync,
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import {
  DEFAULT_STYLE_PROPS,
  ErrorCodes,
  createInputError,
  type DiffResult,
  type BoundingBox,
  type A11yLevel,
  type A11yResult,
  type A11yViolation,
  type DoctorBrowserCheck,
} from '@wig/canvas-core';
import AxeBuilder from '@axe-core/playwright';

export type BrowserEngine = 'chromium' | 'firefox' | 'webkit';

export interface BrowserManagerConfig {
  engine?: BrowserEngine;
  headless?: boolean;
}

export interface ConnectOptions {
  watchPaths?: string[];
  engine?: BrowserEngine;
  timeoutMs?: number;
}

export interface ScreenshotOptions {
  path?: string;
  selector?: string;
  cwd: string;
  inline?: boolean;
  timeoutMs?: number;
}

export interface SessionState {
  url: string | null;
  viewport: { width: number; height: number };
  watchPaths: string[];
}

export interface DiffOptions {
  cwd: string;
  selector?: string;
  since?: string;
  threshold?: number;
}

export interface DiffManifestRecord {
  ts: string;
  baselinePath: string;
  currentPath: string;
  diffPath: string;
  mismatchedPixels: number;
  mismatchedRatio: number;
  regions: Array<{ x: number; y: number; width: number; height: number }>;
  threshold: number;
  baselineInitialized: boolean;
  url?: string;
  selector?: string;
}

export interface ScreenshotResult {
  path: string;
  width: number;
  height: number;
  timestamp: string;
  base64?: string;
}

export interface StylesOptions {
  selector: string;
  props?: string[];
  timeoutMs?: number;
}

export interface StylesResult {
  selector: string;
  url: string;
  props: Record<string, string>;
}

export interface DomOptions {
  selector?: string;
  depth?: number;
  timeoutMs?: number;
}

export interface DomNode {
  role: string;
  name?: string;
  level?: number;
  children?: DomNode[];
}

export interface DomResult {
  selector?: string;
  url: string;
  depth: number;
  root: DomNode;
  yaml: string;
}

export interface DescribeOptions {
  selector: string;
  timeoutMs?: number;
}

export interface DescribeResult {
  selector: string;
  url: string;
  summary: string;
  role: string;
  name?: string;
  box: { x: number; y: number; width: number; height: number };
  visible: boolean;
  disabled: boolean;
  styles: Record<string, string>;
  children: Array<{ role: string; name?: string; tag?: string }>;
}

export interface ContextOptions {
  selector?: string;
  depth?: number;
  cwd: string;
  timeoutMs?: number;
}

export interface ContextResult {
  selector?: string;
  url: string;
  screenshot: ScreenshotResult;
  describe: DescribeResult;
  dom: DomResult;
  styles: StylesResult;
}

const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
const SCREENSHOTS_DIR = '.canvas/screenshots';

const DEFAULT_DOM_DEPTH = 5;

const COMMON_SELECTORS = [
  'body',
  'main',
  'header',
  'footer',
  'nav',
  'section',
  'article',
  'aside',
  'h1',
  'h2',
  'h3',
  'button',
  'a',
  'input',
  'form',
  '[role="main"]',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
];

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private config: BrowserManagerConfig;
  private watchPaths: string[] = [];
  private onUiEvent: ((event: { type: string; ts: string; duration_ms?: number }) => void) | null =
    null;
  private lastHmrStartTs: number | null = null;
  private defaultTimeoutMs = 30_000;

  constructor(
    config: BrowserManagerConfig = {},
    options?: { onUiEvent?: (event: { type: string; ts: string; duration_ms?: number }) => void }
  ) {
    this.onUiEvent = options?.onUiEvent ?? null;
    this.config = {
      engine: config.engine ?? 'chromium',
      headless: config.headless ?? true,
    };
  }

  async launchBrowser(): Promise<void> {
    if (this.browser) {
      return;
    }

    const engine = this.config.engine ?? 'chromium';
    const browserType = engine === 'firefox' ? firefox : engine === 'webkit' ? webkit : chromium;

    this.browser = await browserType.launch({
      headless: this.config.headless,
    });

    console.error(
      `Browser launched (engine: ${engine}, headless: ${String(this.config.headless)})`
    );
  }

  async closeBrowser(): Promise<void> {
    if (this.page) {
      await this.page.close();
      this.page = null;
    }

    if (this.context) {
      await this.context.close();
      this.context = null;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      console.error('Browser closed');
    }
  }

  async connect(url: string, options?: ConnectOptions): Promise<SessionState> {
    if (options?.engine && options.engine !== this.config.engine) {
      this.config.engine = options.engine;
      await this.closeBrowser();
    }

    if (!this.browser) {
      await this.launchBrowser();
    }

    if (this.page) {
      await this.page.close();
    }

    if (this.context) {
      await this.context.close();
    }

    if (!this.browser) {
      throw new Error('Browser failed to launch');
    }

    this.context = await this.browser.newContext({
      viewport: DEFAULT_VIEWPORT,
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    });

    if (options?.timeoutMs) {
      this.context.setDefaultTimeout(options.timeoutMs);
      this.context.setDefaultNavigationTimeout(options.timeoutMs);
    } else {
      this.context.setDefaultTimeout(this.defaultTimeoutMs);
      this.context.setDefaultNavigationTimeout(this.defaultTimeoutMs);
    }

    this.page = await this.context.newPage();
    this.installUiEventBridge(this.page);
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });

    const currentUrl = this.page.url();
    console.error(`Connected to: ${currentUrl}`);

    this.watchPaths = options?.watchPaths ?? [];

    return {
      url: currentUrl,
      viewport: DEFAULT_VIEWPORT,
      watchPaths: this.watchPaths,
    };
  }

  async disconnect(): Promise<void> {
    if (this.page) {
      await this.page.close();
      this.page = null;
    }

    if (this.context) {
      await this.context.close();
      this.context = null;
    }

    this.watchPaths = [];

    console.error('Disconnected from page');
  }

  getSessionState(): SessionState {
    if (!this.page) {
      return { url: null, viewport: DEFAULT_VIEWPORT, watchPaths: this.watchPaths };
    }

    return {
      url: this.page.url(),
      viewport: DEFAULT_VIEWPORT,
      watchPaths: this.watchPaths,
    };
  }

  isConnected(): boolean {
    return this.page !== null && !this.page.isClosed();
  }

  getPage(): Page | null {
    return this.page;
  }

  getEngine(): BrowserEngine {
    return this.config.engine ?? 'chromium';
  }

  async getA11y(options: {
    selector?: string;
    level: A11yLevel;
    timeoutMs?: number;
  }): Promise<A11yResult> {
    if (!this.page || this.page.isClosed()) {
      throw new Error('No page connected. Use connect first.');
    }

    if (options.timeoutMs) {
      this.page.setDefaultTimeout(options.timeoutMs);
    } else {
      this.page.setDefaultTimeout(this.defaultTimeoutMs);
    }

    let builder = new AxeBuilder({ page: this.page });
    if (options.selector) {
      builder = builder.include(options.selector);
    }

    const tags =
      options.level === 'A' ? ['wcag2a'] : options.level === 'AAA' ? ['wcag2aaa'] : ['wcag2aa'];
    builder = builder.withTags(tags);

    const raw = (await builder.analyze()) as {
      violations?: A11yViolation[];
      passes?: A11yViolation[];
      incomplete?: A11yViolation[];
      inapplicable?: A11yViolation[];
    };

    const engine = this.getEngine();
    const notes =
      engine === 'chromium'
        ? undefined
        : [
            'Some checks may vary by browser engine. For most consistent a11y results, prefer chromium.',
          ];

    return {
      url: this.page.url(),
      selector: options.selector,
      level: options.level,
      timestamp: new Date().toISOString(),
      browser: engine,
      notes,
      violations: raw.violations ?? [],
      passes: raw.passes,
      incomplete: raw.incomplete,
      inapplicable: raw.inapplicable,
    };
  }

  getBrowserInstallChecks(): DoctorBrowserCheck[] {
    const engines: BrowserEngine[] = ['chromium', 'firefox', 'webkit'];
    return engines.map((engine) => {
      const browserType = engine === 'firefox' ? firefox : engine === 'webkit' ? webkit : chromium;
      const executablePath = browserType.executablePath();
      const installed = executablePath.length > 0 && existsSync(executablePath);
      return {
        engine,
        executablePath,
        installed,
      };
    });
  }

  async getSelectorCandidates(failedSelector: string): Promise<string[]> {
    if (!this.page || this.page.isClosed()) {
      return [];
    }

    const candidates: string[] = [];

    for (const selector of COMMON_SELECTORS) {
      if (selector === failedSelector) continue;
      try {
        const count = await this.page.locator(selector).count();
        if (count > 0) {
          candidates.push(selector);
        }
      } catch {
        continue;
      }
    }

    if (failedSelector.startsWith('.') || failedSelector.startsWith('#')) {
      type BrowserGlobals = {
        document: {
          querySelectorAll: (sel: string) => ArrayLike<{
            classList: Iterable<string>;
            id: string;
          }>;
        };
      };

      const similarSelectors = await this.page.evaluate((failed: string) => {
        const results: string[] = [];
        const isClass = failed.startsWith('.');
        const searchTerm = failed.slice(1).toLowerCase();
        const doc = (globalThis as unknown as BrowserGlobals).document;

        if (isClass) {
          const allClasses = new Set<string>();
          const elements = doc.querySelectorAll('[class]');
          for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            if (el) {
              for (const c of el.classList) {
                allClasses.add(c);
              }
            }
          }
          for (const c of allClasses) {
            if (c.toLowerCase().includes(searchTerm) || searchTerm.includes(c.toLowerCase())) {
              results.push(`.${c}`);
              if (results.length >= 5) break;
            }
          }
        } else {
          const allIds = new Set<string>();
          const elements = doc.querySelectorAll('[id]');
          for (let i = 0; i < elements.length; i++) {
            const el = elements[i];
            if (el?.id) allIds.add(el.id);
          }
          for (const id of allIds) {
            if (id.toLowerCase().includes(searchTerm) || searchTerm.includes(id.toLowerCase())) {
              results.push(`#${id}`);
              if (results.length >= 5) break;
            }
          }
        }
        return results;
      }, failedSelector);

      candidates.push(...similarSelectors);
    }

    return [...new Set(candidates)].slice(0, 5);
  }

  async takeScreenshot(options: ScreenshotOptions): Promise<ScreenshotResult> {
    if (!this.page || this.page.isClosed()) {
      throw new Error('No page connected. Use connect first.');
    }

    if (options.timeoutMs) {
      this.page.setDefaultTimeout(options.timeoutMs);
    } else {
      this.page.setDefaultTimeout(this.defaultTimeoutMs);
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const screenshotsDir = join(options.cwd, SCREENSHOTS_DIR);

    if (!existsSync(screenshotsDir)) {
      mkdirSync(screenshotsDir, { recursive: true });
    }

    const outputPath = options.path ?? join(screenshotsDir, `${timestamp}.png`);
    const outputDir = dirname(outputPath);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const buffer = await this.captureScreenshotPng({
      selector: options.selector,
      outPath: outputPath,
    });

    const viewportSize = this.page.viewportSize();

    const result: ScreenshotResult = {
      path: outputPath,
      width: viewportSize?.width ?? DEFAULT_VIEWPORT.width,
      height: viewportSize?.height ?? DEFAULT_VIEWPORT.height,
      timestamp: new Date().toISOString(),
    };

    if (options.inline) {
      result.base64 = buffer.toString('base64');
    }

    return result;
  }

  async takeDiff(options: DiffOptions): Promise<DiffResult> {
    if (!this.page || this.page.isClosed()) {
      throw new Error('No page connected. Use connect first.');
    }

    this.page.setDefaultTimeout(this.defaultTimeoutMs);

    const threshold = options.threshold ?? 0.1;

    const screenshotsDir = join(options.cwd, SCREENSHOTS_DIR);
    if (!existsSync(screenshotsDir)) {
      mkdirSync(screenshotsDir, { recursive: true });
    }

    const diffsDir = join(options.cwd, '.canvas/diffs');
    if (!existsSync(diffsDir)) {
      mkdirSync(diffsDir, { recursive: true });
    }

    const baselineMarkerPath = join(diffsDir, 'baseline.json');
    const baselineDefaultPath = join(screenshotsDir, 'baseline.png');

    const baselinePath = this.resolveBaselinePath({
      cwd: options.cwd,
      since: options.since,
      baselineMarkerPath,
      baselineDefaultPath,
    });

    const nowIso = new Date().toISOString();
    const timestampSafe = nowIso.replace(/[:.]/g, '-');

    const currentPath = join(screenshotsDir, `${timestampSafe}.png`);
    await this.captureScreenshotPng({ selector: options.selector, outPath: currentPath });

    if (!baselinePath) {
      writeFileSync(
        baselineMarkerPath,
        JSON.stringify(
          {
            baselinePath: baselineDefaultPath,
            updatedAt: nowIso,
          },
          null,
          2
        )
      );

      writeFileSync(baselineDefaultPath, readFileSync(currentPath));

      const result: DiffResult = {
        baselinePath: baselineDefaultPath,
        currentPath,
        diffPath: '',
        mismatchedPixels: 0,
        mismatchedRatio: 0,
        regions: [],
        baselineInitialized: true,
        threshold,
        summary: 'No baseline existed; baseline initialized.',
      };

      this.appendDiffManifest(diffsDir, {
        ts: nowIso,
        baselinePath: result.baselinePath,
        currentPath: result.currentPath,
        diffPath: result.diffPath,
        mismatchedPixels: result.mismatchedPixels,
        mismatchedRatio: result.mismatchedRatio,
        regions: result.regions,
        threshold,
        baselineInitialized: true,
        url: this.page.url(),
        selector: options.selector,
      });

      return result;
    }

    const diffPath = join(diffsDir, `${timestampSafe}.diff.png`);

    const { mismatchedPixels, mismatchedRatio, regions } = this.computeDiff({
      baselinePath,
      currentPath,
      diffPath,
      threshold,
    });

    writeFileSync(
      baselineMarkerPath,
      JSON.stringify(
        {
          baselinePath: baselineDefaultPath,
          updatedAt: nowIso,
        },
        null,
        2
      )
    );
    writeFileSync(baselineDefaultPath, readFileSync(currentPath));

    const summary = this.summarizeRegions(regions);

    const result: DiffResult = {
      baselinePath,
      currentPath,
      diffPath,
      mismatchedPixels,
      mismatchedRatio,
      regions,
      baselineInitialized: false,
      threshold,
      summary,
    };

    this.appendDiffManifest(diffsDir, {
      ts: nowIso,
      baselinePath: result.baselinePath,
      currentPath: result.currentPath,
      diffPath: result.diffPath,
      mismatchedPixels: result.mismatchedPixels,
      mismatchedRatio: result.mismatchedRatio,
      regions: result.regions,
      threshold,
      baselineInitialized: false,
      url: this.page.url(),
      selector: options.selector,
    });

    return result;
  }

  private async captureScreenshotPng(options: {
    selector?: string;
    outPath: string;
  }): Promise<Buffer> {
    if (!this.page || this.page.isClosed()) {
      throw new Error('No page connected. Use connect first.');
    }

    if (options.selector) {
      const locator = this.page.locator(options.selector);
      return locator.screenshot({ path: options.outPath });
    }

    return this.page.screenshot({ path: options.outPath, fullPage: false });
  }

  private computeDiff(options: {
    baselinePath: string;
    currentPath: string;
    diffPath: string;
    threshold: number;
  }): { mismatchedPixels: number; mismatchedRatio: number; regions: BoundingBox[] } {
    const baseline = PNG.sync.read(readFileSync(options.baselinePath));
    const current = PNG.sync.read(readFileSync(options.currentPath));

    if (baseline.width !== current.width || baseline.height !== current.height) {
      throw new Error(
        `Image dimensions must match. Baseline: ${baseline.width}x${baseline.height}, current: ${current.width}x${current.height}`
      );
    }

    const diff = new PNG({ width: baseline.width, height: baseline.height });

    const mismatchedPixels = pixelmatch(
      baseline.data,
      current.data,
      diff.data,
      baseline.width,
      baseline.height,
      { threshold: options.threshold }
    );

    const mismatchedRatio = mismatchedPixels / (baseline.width * baseline.height);

    writeFileSync(options.diffPath, PNG.sync.write(diff));

    const regions = this.computeRegionsFromDiffMask(diff, mismatchedPixels);

    return { mismatchedPixels, mismatchedRatio, regions };
  }

  private computeRegionsFromDiffMask(diff: PNG, mismatchedPixels: number): BoundingBox[] {
    if (mismatchedPixels === 0) {
      return [];
    }

    const { width, height, data } = diff;

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const a = data[idx + 3];
        if ((a ?? 0) > 0) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    if (maxX < 0 || maxY < 0) {
      return [];
    }

    return [
      {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
      },
    ];
  }

  private summarizeRegions(regions: BoundingBox[]): string {
    if (regions.length === 0) {
      return 'No visual changes detected.';
    }

    let largest = regions[0];
    if (!largest) {
      return 'No visual changes detected.';
    }

    for (const r of regions) {
      if (r.width * r.height > largest.width * largest.height) {
        largest = r;
      }
    }

    const quadrantX = largest.x + largest.width / 2;
    const quadrantY = largest.y + largest.height / 2;

    const horiz = quadrantX < DEFAULT_VIEWPORT.width / 2 ? 'left' : 'right';
    const vert = quadrantY < DEFAULT_VIEWPORT.height / 2 ? 'top' : 'bottom';

    return `${String(regions.length)} region(s) changed; largest change near ${vert}-${horiz}.`;
  }

  private resolveBaselinePath(options: {
    cwd: string;
    since?: string;
    baselineMarkerPath: string;
    baselineDefaultPath: string;
  }): string | null {
    if (options.since && options.since !== 'last') {
      const ts = Date.parse(options.since);
      if (!Number.isFinite(ts)) {
        throw createInputError(
          ErrorCodes.INPUT_TIMESTAMP_INVALID,
          `Invalid --since timestamp: ${options.since}`,
          'since',
          { suggestion: 'Use ISO 8601 format (e.g. 2026-01-14T10:00:00Z) or "last".' }
        );
      }

      const chosen = this.pickScreenshotAtOrBefore(options.cwd, ts);
      return chosen;
    }

    if (existsSync(options.baselineMarkerPath)) {
      try {
        const marker = JSON.parse(readFileSync(options.baselineMarkerPath, 'utf-8')) as {
          baselinePath?: string;
        };
        if (marker.baselinePath) {
          const abs = this.toAbsolutePath(options.cwd, marker.baselinePath);
          if (existsSync(abs)) return abs;
        }
      } catch {}
    }

    const last = this.pickMostRecentScreenshot(options.cwd);
    return last;
  }

  private pickMostRecentScreenshot(cwd: string): string | null {
    const dir = join(cwd, SCREENSHOTS_DIR);
    if (!existsSync(dir)) return null;

    const entries = readdirSync(dir)
      .filter((n) => n.endsWith('.png'))
      .map((name) => ({ name, full: join(dir, name) }))
      .filter((e) => e.name !== 'baseline.png');

    if (entries.length === 0) return null;

    entries.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
    return entries[0]?.full ?? null;
  }

  private pickScreenshotAtOrBefore(cwd: string, targetMs: number): string | null {
    const dir = join(cwd, SCREENSHOTS_DIR);
    if (!existsSync(dir)) return null;

    const candidates: Array<{ name: string; full: string; ts: number }> = [];

    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.png') || name === 'baseline.png') continue;
      const raw = name.replace(/\.png$/, '').replace(/-/g, ':');
      const parsed = Date.parse(raw);
      if (!Number.isFinite(parsed)) continue;
      if (parsed <= targetMs) {
        candidates.push({ name, full: join(dir, name), ts: parsed });
      }
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.ts - a.ts);
    return candidates[0]?.full ?? null;
  }

  private toAbsolutePath(cwd: string, maybePath: string): string {
    if (isAbsolute(maybePath)) return maybePath;
    return resolve(cwd, maybePath);
  }

  private appendDiffManifest(
    diffsDir: string,
    record: {
      ts: string;
      baselinePath: string;
      currentPath: string;
      diffPath: string;
      mismatchedPixels: number;
      mismatchedRatio: number;
      regions: BoundingBox[];
      threshold: number;
      baselineInitialized: boolean;
      url?: string;
      selector?: string;
    }
  ): void {
    const manifestPath = join(diffsDir, 'manifest.jsonl');
    const payload = {
      ...record,
      baselinePath: relative(diffsDir, record.baselinePath),
      currentPath: relative(diffsDir, record.currentPath),
      diffPath: record.diffPath ? relative(diffsDir, record.diffPath) : '',
    };

    appendFileSync(manifestPath, JSON.stringify(payload) + '\n');
  }

  async getStyles(options: StylesOptions): Promise<StylesResult> {
    if (!this.page || this.page.isClosed()) {
      throw new Error('No page connected. Use connect first.');
    }

    if (options.timeoutMs) {
      this.page.setDefaultTimeout(options.timeoutMs);
    } else {
      this.page.setDefaultTimeout(this.defaultTimeoutMs);
    }

    const propsToGet = options.props ?? [...DEFAULT_STYLE_PROPS];
    const locator = this.page.locator(options.selector).first();

    type EvaluateParams = { propNames: string[] };
    const computedStyles = await locator.evaluate<Record<string, string>, EvaluateParams>(
      (el, args) => {
        type BrowserGlobals = {
          getComputedStyle: (el: unknown) => { getPropertyValue: (prop: string) => string };
        };
        const styles = (globalThis as unknown as BrowserGlobals).getComputedStyle(el);
        const result: Record<string, string> = {};
        for (const prop of args.propNames) {
          result[prop] = styles.getPropertyValue(prop);
        }
        return result;
      },
      { propNames: propsToGet as string[] }
    );

    return {
      selector: options.selector,
      url: this.page.url(),
      props: computedStyles,
    };
  }

  async getDom(options: DomOptions): Promise<DomResult> {
    if (!this.page || this.page.isClosed()) {
      throw new Error('No page connected. Use connect first.');
    }

    if (options.timeoutMs) {
      this.page.setDefaultTimeout(options.timeoutMs);
    } else {
      this.page.setDefaultTimeout(this.defaultTimeoutMs);
    }

    const depth = options.depth ?? DEFAULT_DOM_DEPTH;
    const rootSelector = options.selector ?? 'body';
    const locator = this.page.locator(rootSelector).first();

    const yaml = await locator.ariaSnapshot();

    const root = this.parseAriaYaml(yaml, depth);

    return {
      selector: options.selector,
      url: this.page.url(),
      depth,
      root,
      yaml,
    };
  }

  async getDescribe(options: DescribeOptions): Promise<DescribeResult> {
    if (!this.page || this.page.isClosed()) {
      throw new Error('No page connected. Use connect first.');
    }

    if (options.timeoutMs) {
      this.page.setDefaultTimeout(options.timeoutMs);
    } else {
      this.page.setDefaultTimeout(this.defaultTimeoutMs);
    }

    const locator = this.page.locator(options.selector).first();

    const boundingBox = await locator.boundingBox();
    const box = boundingBox ?? { x: 0, y: 0, width: 0, height: 0 };

    const isVisible = await locator.isVisible();
    const isDisabled = await locator.isDisabled().catch(() => false);

    const ariaYaml = await locator.ariaSnapshot();
    const ariaInfo = this.parseFirstAriaNode(ariaYaml);

    const styleProps = ['display', 'background-color', 'color', 'font-size', 'position'];
    type EvaluateParams = { propNames: string[] };
    const styles = await locator.evaluate<Record<string, string>, EvaluateParams>(
      (el, args) => {
        type BrowserGlobals = {
          getComputedStyle: (el: unknown) => { getPropertyValue: (prop: string) => string };
        };
        const computed = (globalThis as unknown as BrowserGlobals).getComputedStyle(el);
        const result: Record<string, string> = {};
        for (const prop of args.propNames) {
          result[prop] = computed.getPropertyValue(prop);
        }
        return result;
      },
      { propNames: styleProps }
    );

    const childrenInfo = await locator.evaluate((el) => {
      const children: Array<{ role: string; name?: string; tag?: string }> = [];
      const childEls = el.children;
      for (let i = 0; i < Math.min(childEls.length, 10); i++) {
        const child = childEls[i];
        if (child) {
          const role = child.getAttribute('role') || child.tagName.toLowerCase();
          const name = child.getAttribute('aria-label') || child.getAttribute('title') || undefined;
          children.push({ role, name, tag: child.tagName.toLowerCase() });
        }
      }
      return children;
    });

    const summary = this.generateSummary(
      ariaInfo,
      box,
      styles,
      childrenInfo,
      isVisible,
      isDisabled
    );

    return {
      selector: options.selector,
      url: this.page.url(),
      summary,
      role: ariaInfo.role,
      name: ariaInfo.name,
      box,
      visible: isVisible,
      disabled: isDisabled,
      styles,
      children: childrenInfo,
    };
  }

  async getContext(options: ContextOptions): Promise<ContextResult> {
    if (!this.page || this.page.isClosed()) {
      throw new Error('No page connected. Use connect first.');
    }

    if (options.timeoutMs) {
      this.page.setDefaultTimeout(options.timeoutMs);
    } else {
      this.page.setDefaultTimeout(this.defaultTimeoutMs);
    }

    const selector = options.selector ?? 'body';
    const depth = options.depth ?? DEFAULT_DOM_DEPTH;

    const [screenshot, describe, dom, styles] = await Promise.all([
      this.takeScreenshot({ selector: options.selector, cwd: options.cwd }),
      this.getDescribe({ selector }),
      this.getDom({ selector: options.selector, depth }),
      this.getStyles({ selector }),
    ]);

    return {
      selector: options.selector,
      url: this.page.url(),
      screenshot,
      describe,
      dom,
      styles,
    };
  }

  private installUiEventBridge(page: Page): void {
    void page
      .exposeFunction('__canvas_emit_ui_event', (payload: unknown) => {
        if (!payload || typeof payload !== 'object') return;
        const p = payload as { type?: unknown; duration_ms?: unknown };
        if (typeof p.type !== 'string') return;

        const ts = new Date().toISOString();

        if (p.type === 'hmr_start') {
          this.lastHmrStartTs = Date.now();
          this.onUiEvent?.({ type: 'hmr_start', ts });
          return;
        }

        if (p.type === 'hmr_complete') {
          const startedAt = this.lastHmrStartTs;
          const duration_ms =
            typeof p.duration_ms === 'number'
              ? p.duration_ms
              : startedAt
                ? Date.now() - startedAt
                : undefined;
          this.onUiEvent?.({ type: 'hmr_complete', ts, duration_ms });
          return;
        }

        this.onUiEvent?.({ type: p.type, ts });
      })
      .catch(() => {});

    void page
      .addInitScript(
        `
(() => {
  const emit = (type, data) => {
    const fn = globalThis.__canvas_emit_ui_event;
    if (typeof fn === 'function') {
      fn({ type, duration_ms: data?.duration_ms });
    }
  };

  if (typeof globalThis.MutationObserver === 'function') {
    let timer = null;
    const observer = new MutationObserver(() => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => {
        emit('ui_changed');
      }, 250);
    });

    observer.observe(document.documentElement, {
      attributes: true,
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  try {
    const ws = new WebSocket(\`ws://\${location.host}/_next/webpack-hmr\`);
    let hmrStartTs = null;
    ws.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string') return;
      try {
        const msg = JSON.parse(ev.data);
        if (msg && msg.action === 'building') {
          hmrStartTs = Date.now();
          emit('hmr_start');
          return;
        }
        if (msg && (msg.action === 'built' || msg.action === 'sync')) {
          const dur = hmrStartTs ? Date.now() - hmrStartTs : undefined;
          emit('hmr_complete', { duration_ms: dur });
          hmrStartTs = null;
        }
      } catch {
      }
    });
  } catch {
  }
})();
`
      )
      .catch(() => {});
  }

  private parseFirstAriaNode(yaml: string): { role: string; name?: string } {
    const firstLine = yaml.split('\n').find((line) => line.trim().startsWith('-'));
    if (!firstLine) {
      return { role: 'region' };
    }

    const match = /^(\s*)- (\w+)(?:\s+"([^"]*)")?/.exec(firstLine);
    if (!match) {
      return { role: 'region' };
    }

    return {
      role: match[2] ?? 'region',
      name: match[3],
    };
  }

  private generateSummary(
    ariaInfo: { role: string; name?: string },
    box: { x: number; y: number; width: number; height: number },
    styles: Record<string, string>,
    children: Array<{ role: string; name?: string; tag?: string }>,
    visible: boolean,
    disabled: boolean
  ): string {
    const parts: string[] = [];

    if (ariaInfo.name) {
      parts.push(`A ${ariaInfo.role} named "${ariaInfo.name}"`);
    } else {
      parts.push(`A ${ariaInfo.role}`);
    }

    parts.push(
      `at (${Math.round(box.x)}, ${Math.round(box.y)}) sized ${Math.round(box.width)}x${Math.round(box.height)}px`
    );

    const styleCues: string[] = [];
    const display = styles['display'];
    if (display && display !== 'block' && display !== 'inline') {
      styleCues.push(display);
    }
    const position = styles['position'];
    if (position && position !== 'static') {
      styleCues.push(`${position} positioned`);
    }
    const bgColor = styles['background-color'];
    if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
      styleCues.push(`bg: ${bgColor}`);
    }

    if (styleCues.length > 0) {
      parts.push(`[${styleCues.join(', ')}]`);
    }

    if (!visible) {
      parts.push('(hidden)');
    }
    if (disabled) {
      parts.push('(disabled)');
    }

    if (children.length > 0) {
      const childRoles = [...new Set(children.map((c) => c.role))];
      if (children.length <= 3) {
        parts.push(`Contains: ${childRoles.join(', ')}`);
      } else {
        parts.push(
          `Contains ${children.length} children: ${childRoles.slice(0, 3).join(', ')}${childRoles.length > 3 ? '...' : ''}`
        );
      }
    }

    return parts.join('. ').replace(/\. \(/g, ' (').replace(/\.\./g, '.');
  }

  private parseAriaYaml(yaml: string, maxDepth: number): DomNode {
    const lines = yaml.split('\n').filter((line) => line.trim());
    if (lines.length === 0) {
      return { role: 'region' };
    }

    const parseNode = (
      lineIndex: number,
      currentDepth: number,
      _baseIndent: number
    ): [DomNode, number] => {
      if (lineIndex >= lines.length || currentDepth > maxDepth) {
        return [{ role: 'region' }, lineIndex];
      }

      const line = lines[lineIndex] ?? '';
      const match = /^(\s*)- (\w+)(?:\s+"([^"]*)")?(?:\s+\[([^\]]+)\])?/.exec(line);
      if (!match) {
        return [{ role: 'region' }, lineIndex + 1];
      }

      const indent = (match[1] ?? '').length;
      const role = match[2] ?? 'region';
      const name = match[3];
      const attrs = match[4];

      let level: number | undefined;
      if (attrs) {
        const levelMatch = /level=(\d+)/.exec(attrs);
        if (levelMatch?.[1]) {
          level = parseInt(levelMatch[1], 10);
        }
      }

      const node: DomNode = { role };
      if (name) node.name = name;
      if (level) node.level = level;

      if (currentDepth >= maxDepth) {
        return [node, lineIndex + 1];
      }

      const children: DomNode[] = [];
      let nextIndex = lineIndex + 1;

      while (nextIndex < lines.length) {
        const nextLine = lines[nextIndex] ?? '';
        const nextMatch = /^(\s*)- /.exec(nextLine);
        if (!nextMatch) {
          nextIndex++;
          continue;
        }

        const nextIndent = (nextMatch[1] ?? '').length;
        if (nextIndent <= indent) {
          break;
        }

        const [childNode, consumedIndex] = parseNode(nextIndex, currentDepth + 1, indent);
        children.push(childNode);
        nextIndex = consumedIndex;
      }

      if (children.length > 0) {
        node.children = children;
      }

      return [node, nextIndex];
    };

    const topLevelNodes: DomNode[] = [];
    let index = 0;
    while (index < lines.length) {
      const line = lines[index] ?? '';
      const match = /^(\s*)- /.exec(line);
      if (!match) {
        index++;
        continue;
      }
      const [node, consumedIndex] = parseNode(index, 1, -1);
      topLevelNodes.push(node);
      index = consumedIndex;
    }

    if (topLevelNodes.length === 1 && topLevelNodes[0]) {
      return topLevelNodes[0];
    }

    return {
      role: 'region',
      children: topLevelNodes,
    };
  }
}
