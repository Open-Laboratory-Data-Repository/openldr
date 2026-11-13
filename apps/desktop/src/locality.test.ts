import { describe, expect, it } from 'vitest';
import { isLocalAddress, linkTarget, mayAnswerStudio, mayGrantPermission, sameOrigin } from './locality';

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
