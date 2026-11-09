// Adds DOM matchers such as expect(element).toBeInTheDocument().
import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Test files run in parallel and each first renders the whole app from a cold start, so the
// first screen can take more than the default 1 s under load. findBy/waitFor retry for up to
// 5 s instead; what they check is unchanged, and a passing test still finishes immediately.
configure({ asyncUtilTimeout: 5000 });

// jsdom (the simulated browser) lacks a few APIs that UI libraries use.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
