/**
 * Phase 9, Milestone 3 (Checkpoint 1): how each engine is launched and given a context.
 * Pure option building (no browser needed): Chromium's options are exactly as before;
 * Firefox and WebKit go through the proxy with no exceptions; Firefox's preferences
 * close its ways around the proxy; Firefox gets no mobile emulation.
 */
import { describe, expect, it } from 'vitest';
import { contextOptions, FIREFOX_HARDENING_PREFS, launchOptions } from '../src/browser';
import { SCAN_VIEWPORTS } from '../src/browser-types';
import { loadScannerConfig } from '../src/config';

const config = { headless: true, browserChannel: undefined, egressProxyUrl: 'http://proxy:3128' };
const mobile = SCAN_VIEWPORTS.find((v) => v.mobile)!;

describe('launch options', () => {
  it('Chromium: unchanged from before Milestone 3', () => {
    expect(launchOptions('chromium', config)).toEqual({
      headless: true,
      channel: undefined,
      timeout: 60_000,
      proxy: { server: 'http://proxy:3128', bypass: '<-loopback>' },
      args: [
        '--disable-quic',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-sync',
        '--no-first-run',
      ],
    });
  });

  it('Firefox: the proxy with no exceptions, and the hardening preferences', () => {
    const options = launchOptions('firefox', config);
    expect(options.proxy).toEqual({ server: 'http://proxy:3128', bypass: '' });
    expect(options.firefoxUserPrefs).toBe(FIREFOX_HARDENING_PREFS);
    expect(FIREFOX_HARDENING_PREFS).toMatchObject({
      'network.proxy.allow_hijacking_localhost': true, // localhost goes to the proxy too
      'network.proxy.no_proxies_on': '',
      'network.http.http3.enable': false, // no QUIC over UDP
      'media.peerconnection.enabled': false, // no WebRTC
      'network.trr.mode': 5, // no DNS over HTTPS
      'network.dns.disablePrefetch': true,
      'network.prefetch-next': false,
      'network.predictor.enabled': false,
    });
  });

  it('WebKit: the proxy with no exceptions', () => {
    expect(launchOptions('webkit', config)).toEqual({
      headless: true,
      timeout: 60_000,
      proxy: { server: 'http://proxy:3128', bypass: '' },
    });
  });
});

describe('context options', () => {
  it('Chromium and WebKit emulate mobile sizes; Firefox never gets mobile emulation', () => {
    expect(contextOptions('chromium', mobile, 'ua')).toMatchObject({
      isMobile: true,
      hasTouch: true,
    });
    expect(contextOptions('webkit', mobile, 'ua')).toMatchObject({
      isMobile: true,
      hasTouch: true,
    });
    const ff = contextOptions('firefox', mobile, 'ua');
    expect('isMobile' in ff).toBe(false);
    expect('hasTouch' in ff).toBe(false);
  });

  it('every engine: no downloads, no service workers, HTTPS errors not ignored', () => {
    for (const engine of ['chromium', 'firefox', 'webkit'] as const) {
      expect(contextOptions(engine, SCAN_VIEWPORTS[0]!, 'ua')).toMatchObject({
        acceptDownloads: false,
        serviceWorkers: 'block',
        ignoreHTTPSErrors: false,
      });
    }
  });
});

describe('server caps', () => {
  const base = {
    DATABASE_URL: 'postgresql://user:pw@db:5432/whc',
    REDIS_URL: 'redis://redis:6379',
    EGRESS_PROXY_URL: 'http://proxy:3128',
  };
  it('SCAN_COMPAT_BROWSERS lists the allowed engines; empty allows none; unknown names are ignored', () => {
    expect(loadScannerConfig({ ...base }).compatBrowsers).toEqual(['firefox', 'webkit']);
    expect(loadScannerConfig({ ...base, SCAN_COMPAT_BROWSERS: '' }).compatBrowsers).toEqual([]);
    expect(
      loadScannerConfig({ ...base, SCAN_COMPAT_BROWSERS: ' WebKit , chrome' }).compatBrowsers,
    ).toEqual(['webkit']);
  });
});
