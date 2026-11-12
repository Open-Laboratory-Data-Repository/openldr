import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { SDK_BOOTSTRAP_V1 } from '../../packages/plugin-ui-sdk/src/bootstrap';

const sample = readFileSync(new URL('../../reference-plugins/ui-reference/ui.html', import.meta.url), 'utf8');

for (const initialTheme of ['light', 'dark'] as const) {
  test(`reference plugin follows ${initialTheme} initialization and live theme changes`, async ({ page }) => {
    // Exercise the sample and actual SDK without installing a plugin or writing its datastore.
    await page.setContent('<iframe title="reference-theme" sandbox="allow-scripts"></iframe>');
    await page.evaluate(({ sample, bootstrap, theme }) => {
      const iframe = document.querySelector('iframe')!;
      iframe.onload = () => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => {
          const { id, op } = event.data;
          const data = op.kind === 'reports.list' ? [{ id: 'sample-report' }] : null;
          channel.port1.postMessage({ id, result: { ok: true, data } });
        };
        iframe.contentWindow!.postMessage({
          type: 'openldr:init', context: { pluginId: 'ui-reference', theme, site: 'page' },
        }, '*', [channel.port2]);
      };
      iframe.srcdoc = `<!doctype html><html data-openldr-theme="${theme}"><body><script>${bootstrap}</script>${sample}</body></html>`;
    }, { sample, bootstrap: SDK_BOOTSTRAP_V1, theme: initialTheme });

    const frame = page.frameLocator('iframe');
    await expect(frame.locator('body')).toHaveAttribute('data-openldr-ready', '1');
    await expect(frame.locator('#reports')).toContainText('sample-report');
    await frame.locator('body').evaluate((body) => body.setAttribute('data-instance', 'original'));

    const themes = [initialTheme, initialTheme === 'light' ? 'dark' : 'light', initialTheme];
    const backgrounds = new Map<string, string>();
    for (const theme of themes) {
      await page.locator('iframe').evaluate((iframe, theme) => {
        (iframe as HTMLIFrameElement).contentWindow!.postMessage({ type: 'openldr:theme', theme }, '*');
      }, theme);
      await expect(frame.locator('html')).toHaveAttribute('data-openldr-theme', theme);
      const colors = await frame.locator('body').evaluate((body) => {
        const selectors = ['.ref p', '.ref h1', '#ping', '#reports'];
        return {
          background: getComputedStyle(body).backgroundColor,
          scheme: getComputedStyle(document.documentElement).colorScheme,
          pairs: selectors.map((selector) => {
            const element = document.querySelector(selector)!;
            const style = getComputedStyle(element);
            let backgroundElement: Element | null = element;
            let background = style.backgroundColor;
            while (background === 'rgba(0, 0, 0, 0)' && backgroundElement?.parentElement) {
              backgroundElement = backgroundElement.parentElement;
              background = getComputedStyle(backgroundElement).backgroundColor;
            }
            return { selector, foreground: style.color, background };
          }),
        };
      });
      expect(colors.scheme).toBe(theme);
      if (backgrounds.has(theme)) expect(colors.background).toBe(backgrounds.get(theme));
      backgrounds.set(theme, colors.background);
      for (const pair of colors.pairs) {
        expect(contrast(pair.foreground, pair.background), `${theme} ${pair.selector}`).toBeGreaterThanOrEqual(4.5);
      }
      await expect(frame.locator('body')).toHaveAttribute('data-instance', 'original');
    }
    expect(backgrounds.get('light')).not.toBe(backgrounds.get('dark'));
  });
}

function contrast(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
