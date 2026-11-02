// @vitest-environment jsdom
/**
 * The popup with a fake `chrome` API: first-use notice, unsupported pages, the
 * "local check, not saved" message, hand-off and what the extension stores.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/popup/App';
import type { PageCheckResult } from '../src/types';
import { sampleResult } from './sample';

let stored: Record<string, unknown>;
let tabUrl: string | undefined;
let checkResult: PageCheckResult | Error;
const created: string[] = [];
const scriptCalls: unknown[] = [];

beforeEach(() => {
  stored = {};
  tabUrl = 'https://shop.example.com/cart?session=abc';
  checkResult = sampleResult;
  created.length = 0;
  scriptCalls.length = 0;
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (keys: string[]) =>
          Object.fromEntries(keys.filter((k) => k in stored).map((k) => [k, stored[k]])),
        set: async (values: Record<string, unknown>) => void Object.assign(stored, values),
      },
    },
    tabs: {
      query: async () => [{ id: 7, url: tabUrl }],
      get: async () => ({ id: 7, url: tabUrl }),
      create: async ({ url }: { url: string }) => void created.push(url),
    },
    scripting: {
      executeScript: async (details: { files?: string[]; args?: string[] }) => {
        scriptCalls.push(details);
        if (details.files) return [{ result: undefined }];
        if (checkResult instanceof Error) throw checkResult;
        return [{ result: details.args?.length ? true : checkResult }];
      },
    },
  });
});

const acknowledge = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'I understand' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'I understand' })).toBeNull());
};

describe('popup', () => {
  it('shows the authorization notice first and only checks after it is acknowledged', async () => {
    render(<App />);
    const check = await screen.findByRole('button', { name: 'Check this page' });
    expect(screen.getByText('Only check websites you own or are authorized to test')).toBeVisible();
    expect(check).toBeDisabled();
    expect(scriptCalls).toHaveLength(0); // nothing touches the page without a click

    await acknowledge();
    expect(stored).toEqual({ noticeAcknowledged: true });
    // The notice stays visible for the rest of this first use.
    expect(screen.getByText('Only check websites you own or are authorized to test')).toBeVisible();
    expect(check).toBeEnabled();
  });

  it('shows results as a local check that is not saved, with frames that were not checked', async () => {
    render(<App />);
    await acknowledge();
    fireEvent.click(screen.getByRole('button', { name: 'Check this page' }));

    expect(await screen.findByTestId('local-note')).toHaveTextContent(
      /Local check, not saved\..*not an official scan/,
    );
    expect(
      screen.getByRole('list', { name: 'Issues' }).querySelectorAll('[data-rule-id]'),
    ).toHaveLength(2);
    expect(screen.getByTestId('frames-note')).toHaveTextContent(
      '1 embedded frame was not checked (1 from other websites)',
    );
    // Results are kept in memory only.
    expect(Object.keys(stored)).toEqual(['noticeAcknowledged']);
  });

  it('keeps a short reminder after the first use', async () => {
    stored = { noticeAcknowledged: true };
    render(<App />);
    expect(
      await screen.findByText(
        /Only check websites you own or are authorized to test\. Results are local/,
      ),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: 'I understand' })).toBeNull();
  });

  it.each([
    ['chrome://settings', /browser page/],
    [undefined, /click the extension icon/],
    ['file:///C:/report.html', /Only web pages/],
  ])('explains why %s cannot be checked', async (url, message) => {
    tabUrl = url;
    stored = { noticeAcknowledged: true };
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByRole('button', { name: 'Check this page' })).toBeNull();
  });

  it('turns injection failures into a readable message', async () => {
    stored = { noticeAcknowledged: true };
    checkResult = new Error(
      'Cannot access contents of the page. Extension manifest must request permission to access the respective host.',
    );
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check this page' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/click the extension icon/);
  });

  it('opens the dashboard with only the page address, on request', async () => {
    stored = { noticeAcknowledged: true };
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Check this page' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open in dashboard' }));
    await waitFor(() => expect(created).toHaveLength(1));
    expect(created[0]).toBe(
      'http://localhost:8081/websites/new?baseUrl=https%3A%2F%2Fshop.example.com%2Fcart',
    );
  });

  it('stores only a valid dashboard address in settings', async () => {
    stored = { noticeAcknowledged: true };
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    const input = screen.getByLabelText('Dashboard address');
    fireEvent.change(input, { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/starting with http/)).toBeVisible();
    fireEvent.change(input, { target: { value: 'https://checker.example.com/' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(stored).toEqual({
        noticeAcknowledged: true,
        dashboardUrl: 'https://checker.example.com',
      }),
    );
  });
});
