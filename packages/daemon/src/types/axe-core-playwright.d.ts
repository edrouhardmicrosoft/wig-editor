declare module '@axe-core/playwright' {
  import type { Page } from 'playwright';

  export default class AxeBuilder {
    constructor(options: { page: Page; axeSource?: string });
    include(selector: string): this;
    withTags(tags: string[]): this;
    analyze(): Promise<unknown>;
  }
}
