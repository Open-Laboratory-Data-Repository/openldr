import { makeScreenshotMap, PUBLIC_SCREENSHOT_NAMES, SCREENSHOTS, screenshotUrl } from './screenshots';

describe('landing screenshots', () => {
  it('keys imported screenshot URLs by bare filename', () => {
    const map = makeScreenshotMap({ './gallery/dashboard.png': '/assets/dashboard.hash.png' });

    expect(map).toEqual({ 'dashboard.png': '/assets/dashboard.hash.png' });
  });

  it('returns null for a screenshot name that is not available', () => {
    expect(screenshotUrl('missing-public-shot.png')).toBeNull();
  });

  it('exposes exactly the screenshots the landing declares', () => {
    expect(Object.keys(SCREENSHOTS).sort()).toEqual([...PUBLIC_SCREENSHOT_NAMES].sort());
  });

  // The landing has its own captures under ./gallery. Reaching back into the docs shots pulls in
  // their numbered callout badges, which are baked into the PNG and read as a tutorial.
  it('serves the landing captures, not the docs ones', () => {
    const docsShots = ['reports-run-result.png', 'workflow-builder.png', 'dashboard-overview.png'];

    for (const name of docsShots) {
      expect(PUBLIC_SCREENSHOT_NAMES).not.toContain(name);
      expect(screenshotUrl(name)).toBeNull();
    }
  });
});
