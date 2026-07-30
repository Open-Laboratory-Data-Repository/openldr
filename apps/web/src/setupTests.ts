import '@testing-library/jest-dom/vitest';

import { configure } from '@testing-library/react';

// Testing Library's own async timeout (waitFor / findBy*) defaults to 1000ms and is INDEPENDENT
// of vitest's testTimeout. The full turbo gate runs ~10 packages at once on 12 cores, and a
// starved render could exceed 1s, so queries failed with "Unable to find role=..." — a message
// that reads like a missing element and is really just contention. The same specs pass alone.
configure({ asyncUtilTimeout: 15000 });

// Radix UI (Tabs) uses pointer-capture + scrollIntoView, which jsdom lacks.
if (typeof Element !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
}
