// The landing site's own captures, produced by `pnpm gallery:screenshots` into ./gallery.
//
// These are deliberately NOT the docs screenshots. The docs manifest paints numbered callout
// badges onto several of its shots, which teach a procedure but read as a tutorial when the point
// is simply to show what the product looks like.
import dashboardUrl from './gallery/dashboard.png?url';
import reportsUrl from './gallery/reports.png?url';
import queryUrl from './gallery/query.png?url';
import formBuilderUrl from './gallery/form-builder.png?url';
import terminologyUrl from './gallery/terminology.png?url';
import reportDesignerUrl from './gallery/report-designer.png?url';
import workflowsUrl from './gallery/workflows.png?url';
import marketplaceUrl from './gallery/marketplace.png?url';

export const PUBLIC_SCREENSHOT_NAMES = [
  'dashboard.png',
  'reports.png',
  'query.png',
  'form-builder.png',
  'terminology.png',
  'report-designer.png',
  'workflows.png',
  'marketplace.png',
] as const;

export type PublicScreenshotName = (typeof PUBLIC_SCREENSHOT_NAMES)[number];

const screenshotModules: Record<string, string> = {
  './gallery/dashboard.png': dashboardUrl,
  './gallery/reports.png': reportsUrl,
  './gallery/query.png': queryUrl,
  './gallery/form-builder.png': formBuilderUrl,
  './gallery/terminology.png': terminologyUrl,
  './gallery/report-designer.png': reportDesignerUrl,
  './gallery/workflows.png': workflowsUrl,
  './gallery/marketplace.png': marketplaceUrl,
};

export function makeScreenshotMap(modules: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(modules).map(([path, url]) => [path.split('/').pop() ?? path, url]),
  );
}

export const SCREENSHOTS = makeScreenshotMap(screenshotModules);

export function screenshotUrl(name: PublicScreenshotName | string): string | null {
  return SCREENSHOTS[name] ?? null;
}
