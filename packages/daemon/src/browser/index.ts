import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
} from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { DEFAULT_STYLE_PROPS } from '@wig/canvas-core';

export type BrowserEngine = 'chromium' | 'firefox' | 'webkit';

export interface BrowserManagerConfig {
  engine?: BrowserEngine;
  headless?: boolean;
}

export interface SessionState {
  url: string | null;
  viewport: { width: number; height: number };
}

export interface ScreenshotOptions {
  path?: string;
  selector?: string;
  cwd: string;
  inline?: boolean;
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
}

export interface StylesResult {
  selector: string;
  url: string;
  props: Record<string, string>;
}

export interface DomOptions {
  selector?: string;
  depth?: number;
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

  constructor(config: BrowserManagerConfig = {}) {
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

  async connect(url: string): Promise<SessionState> {
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

    this.page = await this.context.newPage();
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });

    const currentUrl = this.page.url();
    console.error(`Connected to: ${currentUrl}`);

    return {
      url: currentUrl,
      viewport: DEFAULT_VIEWPORT,
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

    console.error('Disconnected from page');
  }

  getSessionState(): SessionState {
    if (!this.page) {
      return { url: null, viewport: DEFAULT_VIEWPORT };
    }

    return {
      url: this.page.url(),
      viewport: DEFAULT_VIEWPORT,
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

    let buffer: Buffer;
    if (options.selector) {
      const locator = this.page.locator(options.selector);
      buffer = await locator.screenshot({ path: outputPath });
    } else {
      buffer = await this.page.screenshot({ path: outputPath, fullPage: false });
    }

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

  async getStyles(options: StylesOptions): Promise<StylesResult> {
    if (!this.page || this.page.isClosed()) {
      throw new Error('No page connected. Use connect first.');
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
