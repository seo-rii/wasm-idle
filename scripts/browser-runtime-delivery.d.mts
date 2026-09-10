import type { Page } from 'playwright-core';

export function installBrowserRuntimeDelivery(page: Page, baseUrl: string): Promise<void>;
