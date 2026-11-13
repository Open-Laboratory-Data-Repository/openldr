import { describe, expect, it } from 'vitest';
import { frameTarget, isLocalAddress, linkTarget, mayAnswerStudio, mayGrantPermission, renderAfterLoad, sameOrigin, urlForLog } from './locality';

describe('isLocalAddress', () => {
  it.each(['http://localhost:3000/studio/', 'http://127.0.0.1:3000/x', 'http://[::1]:3000'])('%s is local', (url) => {
    expect(isLocalAddress(url)).toBe(true);
  });

  it.each([
    'http://192.168.1.5:3000',
    'http://localhost.example.com',
    'http://127.0.0.1.example.com',
    'file:///x',
    'not a url',
    '',
  ])('%s is not local', (url) => {
    expect(isLocalAddress(url)).toBe(false);
  });
});

describe('sameOrigin', () => {
  it('compares scheme, host and port', () => {
    expect(sameOrigin('http://localhost:3990/studio/setup', 'http://localhost:3990/studio/')).toBe(true);
    expect(sameOrigin('http://localhost:3990/', 'http://127.0.0.1:3990/')).toBe(false);
    expect(sameOrigin('http://localhost:3990/', 'http://localhost:3991/')).toBe(false);
    expect(sameOrigin('https://localhost:3990/', 'http://localhost:3990/')).toBe(false);
  });

  it('is false for URLs with no origin or no URL at all', () => {
    expect(sameOrigin('file:///a', 'file:///a')).toBe(false);
    expect(sameOrigin('not a url', 'not a url')).toBe(false);
    expect(sameOrigin('', '')).toBe(false);
  });
});

describe('mayAnswerStudio', () => {
  const launcher = 'http://localhost:3990/studio/';

  it('answers a page on the launcher address', () => {
    expect(mayAnswerStudio('http://localhost:3990/studio/setup', launcher)).toBe(true);
  });

  it('refuses another origin, even one that reaches the same computer', () => {
    expect(mayAnswerStudio('http://127.0.0.1:3990/studio/', launcher)).toBe(false);
    expect(mayAnswerStudio('http://localhost:3991/studio/', launcher)).toBe(false);
  });

  it('refuses when there is no launcher address', () => {
    expect(mayAnswerStudio('http://localhost:3990/studio/setup', undefined)).toBe(false);
  });

  it('refuses a file: sender', () => {
    expect(mayAnswerStudio('file:///app/pages/page.html', launcher)).toBe(false);
  });

  it('refuses when the launcher address is not local, even from its own origin', () => {
    expect(mayAnswerStudio('http://192.168.1.5:3990/studio/setup', 'http://192.168.1.5:3990/studio/')).toBe(false);
  });
});

describe('linkTarget', () => {
  const launcher = 'http://localhost:3990/studio/';
  const ownPages = ['file:///opt/openldr-desktop/pages/page.html'] as const;

  it('keeps the launcher origin inside', () => {
    expect(linkTarget('http://localhost:3990/studio/', launcher, ownPages)).toBe('inside');
    expect(linkTarget('http://localhost:3990/api/health', launcher, ownPages)).toBe('inside');
  });

  it('keeps the app pages inside, with or without a query or hash', () => {
    expect(linkTarget('file:///opt/openldr-desktop/pages/page.html', launcher, ownPages)).toBe('inside');
    expect(linkTarget('file:///opt/openldr-desktop/pages/page.html?x=1#top', launcher, ownPages)).toBe('inside');
    expect(linkTarget('file:///opt/openldr-desktop/pages/page.html', undefined, ownPages)).toBe('inside');
  });

  it('sends other web and mail links to the browser', () => {
    expect(linkTarget('https://openldr.org/docs', launcher, ownPages)).toBe('browser');
    expect(linkTarget('http://localhost:3991/studio/', launcher, ownPages)).toBe('browser');
    expect(linkTarget('http://127.0.0.1:3990/studio/', launcher, ownPages)).toBe('browser');
    expect(linkTarget('mailto:someone@example.com', launcher, ownPages)).toBe('browser');
    expect(linkTarget('http://localhost:3990/studio/', undefined, ownPages)).toBe('browser');
  });

  it('refuses everything else', () => {
    expect(linkTarget('file:///etc/passwd', launcher, ownPages)).toBe('refuse');
    expect(linkTarget('file:///opt/openldr-desktop/pages/other.html', launcher, ownPages)).toBe('refuse');
    expect(linkTarget('javascript:alert(1)', launcher, ownPages)).toBe('refuse');
    expect(linkTarget('data:text/html,hi', launcher, ownPages)).toBe('refuse');
    expect(linkTarget('ftp://example.com/x', launcher, ownPages)).toBe('refuse');
    expect(linkTarget('not a url', launcher, ownPages)).toBe('refuse');
    expect(linkTarget('', launcher, ownPages)).toBe('refuse');
  });
});

describe('mayGrantPermission', () => {
  const launcher = 'http://localhost:3990/studio/';

  it('allows a sanitized clipboard write from the launcher\'s origin', () => {
    expect(mayGrantPermission('clipboard-sanitized-write', 'http://localhost:3990/studio/users', launcher)).toBe(true);
    expect(mayGrantPermission('clipboard-sanitized-write', 'http://localhost:3990', launcher)).toBe(true);
  });

  it('refuses the clipboard write from any other origin or with no launcher', () => {
    expect(mayGrantPermission('clipboard-sanitized-write', 'http://localhost:3991/studio/', launcher)).toBe(false);
    expect(mayGrantPermission('clipboard-sanitized-write', 'https://example.com/', launcher)).toBe(false);
    expect(mayGrantPermission('clipboard-sanitized-write', 'file:///opt/openldr-desktop/pages/page.html', launcher)).toBe(false);
    expect(mayGrantPermission('clipboard-sanitized-write', 'http://localhost:3990/studio/', undefined)).toBe(false);
    expect(mayGrantPermission('clipboard-sanitized-write', '', launcher)).toBe(false);
  });

  it.each(['clipboard-read', 'media', 'geolocation', 'notifications', 'openExternal', 'fullscreen'])('refuses %s, even from the launcher', (permission) => {
    expect(mayGrantPermission(permission, 'http://localhost:3990/studio/', launcher)).toBe(false);
  });
});

describe('frameTarget', () => {
  const launcher = 'http://localhost:3990/studio/';

  it('allows a frame on the launcher\'s origin', () => {
    expect(frameTarget('http://localhost:3990/studio/plugins/x', launcher)).toBe('allow');
  });

  it('allows about:blank and about:srcdoc, which Studio\'s plugin frames load', () => {
    expect(frameTarget('about:blank', launcher)).toBe('allow');
    expect(frameTarget('about:srcdoc', launcher)).toBe('allow');
    expect(frameTarget('about:srcdoc', undefined)).toBe('allow');
  });

  it('allows a blob: URL of the launcher\'s origin', () => {
    expect(frameTarget('blob:http://localhost:3990/0f1c2d3e-4a5b-6c7d-8e9f-0a1b2c3d4e5f', launcher)).toBe('allow');
  });

  it('refuses any other site, scheme or origin', () => {
    expect(frameTarget('https://example.com/', launcher)).toBe('refuse');
    expect(frameTarget('http://localhost:3991/studio/', launcher)).toBe('refuse');
    expect(frameTarget('blob:https://example.com/0f1c2d3e', launcher)).toBe('refuse');
    expect(frameTarget('data:text/html,hi', launcher)).toBe('refuse');
    expect(frameTarget('file:///etc/passwd', launcher)).toBe('refuse');
    expect(frameTarget('javascript:alert(1)', launcher)).toBe('refuse');
    expect(frameTarget('about:config', launcher)).toBe('refuse');
    expect(frameTarget('http://localhost:3990/studio/', undefined)).toBe('refuse');
    expect(frameTarget('not a url', launcher)).toBe('refuse');
  });
});

describe('renderAfterLoad', () => {
  const own = 'file:///opt/openldr-desktop/pages/page.html';

  it('is true when a load ends on another page while the screen is not Studio', () => {
    expect(renderAfterLoad(false, 'http://localhost:3990/studio/', own)).toBe(true);
    expect(renderAfterLoad(false, 'chrome-error://chromewebdata/', own)).toBe(true);
  });

  it('is false while the screen is Studio', () => {
    expect(renderAfterLoad(true, 'http://localhost:3990/studio/', own)).toBe(false);
  });

  it('is false when the load was the app\'s own page, so a page that fails is not loaded again and again', () => {
    expect(renderAfterLoad(false, own, own)).toBe(false);
    expect(renderAfterLoad(false, `${own}?x=1`, own)).toBe(false);
  });
});

describe('urlForLog', () => {
  it('keeps the origin and the path, and drops the query and the fragment', () => {
    expect(urlForLog('http://localhost:3990/studio/reset?token=PLANTED-SECRET#step=PLANTED-TOO')).toBe('http://localhost:3990/studio/reset');
  });

  it('keeps the scheme and path of a URL with no origin', () => {
    expect(urlForLog('file:///opt/openldr-desktop/pages/page.html?a=b')).toBe('file:///opt/openldr-desktop/pages/page.html');
    expect(urlForLog('about:blank')).toBe('about:blank');
  });

  it('gives a fixed word for a URL it cannot read', () => {
    expect(urlForLog('not a url token=PLANTED')).toBe('(unreadable address)');
    expect(urlForLog('')).toBe('(unreadable address)');
  });
});
