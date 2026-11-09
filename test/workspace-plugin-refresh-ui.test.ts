import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';

vi.mock('../src/renderer/i18n.js', () => ({
  currentLanguage: () => 'en',
  ui: (node: Element, property: string, value: () => string) => {
    if (property === 'textContent') node.textContent = value();
    else node.setAttribute(property, value());
  }
}));
vi.mock('../src/renderer/dom.js', () => ({ toast: vi.fn() }));
import { initWorkspacePluginRefresh } from '../src/renderer/workspace-plugin-refresh.js';

let dom: JSDOM;
let button: HTMLButtonElement;
let notify: Mock<(message: string) => void>;

beforeEach(() => {
  dom = new JSDOM('<button id="workspaceRefreshPlugins" type="button"><i></i><span id="workspaceRefreshPluginsLabel"></span></button>');
  vi.stubGlobal('document', dom.window.document);
  button = dom.window.document.getElementById('workspaceRefreshPlugins') as HTMLButtonElement;
  notify = vi.fn<(message: string) => void>();
});
afterEach(() => {
  vi.unstubAllGlobals();
  dom.window.close();
  vi.clearAllMocks();
});

it('shows a clearly labeled accessible control and queues a check without claiming completion', async () => {
  const requestPluginRefresh = vi.fn(async () => ({ ok: true as const, data: 3 }));
  initWorkspacePluginRefresh({ requestPluginRefresh }, notify);
  expect(button.textContent).toBe('Refresh plugins');
  expect(button.title).toContain('ChatGPT');
  button.click();
  await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce());
  expect(requestPluginRefresh).toHaveBeenCalledOnce();
  expect(notify.mock.calls[0]![0]).toContain('requested');
  expect(notify.mock.calls[0]![0]).not.toContain('completed');
  expect(button.disabled).toBe(false);
  expect(button.hasAttribute('aria-busy')).toBe(false);
});

it('rejects repeat clicks while a request is outstanding', async () => {
  let resolve!: (value: { ok: true; data: number }) => void;
  const requestPluginRefresh = vi.fn(() => new Promise<{ ok: true; data: number }>(done => { resolve = done; }));
  initWorkspacePluginRefresh({ requestPluginRefresh }, notify);
  button.click();
  expect(button.disabled).toBe(true);
  expect(button.getAttribute('aria-busy')).toBe('true');
  button.click();
  expect(requestPluginRefresh).toHaveBeenCalledOnce();
  resolve({ ok: true, data: 1 });
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  expect(notify).toHaveBeenCalledOnce();
});

it('explains an offline connector without claiming that a refresh started', async () => {
  initWorkspacePluginRefresh({ requestPluginRefresh: vi.fn(async () => ({ ok: true as const, data: 0 })) }, notify);
  button.click();
  await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce());
  expect(notify.mock.calls[0]![0]).toContain('No connected plugin tools');
});

it('reports an IPC failure and allows another attempt', async () => {
  const requestPluginRefresh = vi.fn()
    .mockResolvedValueOnce({ ok: false, error: 'ledger unreadable' })
    .mockResolvedValueOnce({ ok: true, data: 1 });
  initWorkspacePluginRefresh({ requestPluginRefresh }, notify);
  button.click();
  await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
  expect(notify.mock.calls[0]![0]).toContain('Could not request');
  expect(button.disabled).toBe(false);
  button.click();
  await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(2));
  expect(requestPluginRefresh).toHaveBeenCalledTimes(2);
});
