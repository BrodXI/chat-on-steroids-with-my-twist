import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, expect, it, vi, type Mock } from 'vitest';
import type { WorkspacePluginRefreshStep } from '../src/shared/workspace-plugin-refresh.js';

vi.mock('../src/renderer/i18n.js', () => ({
  currentLanguage: () => 'en',
  ui: (node: Element, property: string, value: () => string) => {
    if (property === 'textContent') node.textContent = value();
    else node.setAttribute(property, value());
  }
}));
vi.mock('../src/renderer/dom.js', () => ({ toast: vi.fn() }));
import { initWorkspacePluginRefresh, workspaceRefreshOutcome } from '../src/renderer/workspace-plugin-refresh.js';

let dom: JSDOM;
let button: HTMLButtonElement;
let notify: Mock<(message: string) => void>;

const step = (surface: WorkspacePluginRefreshStep['surface'], status: WorkspacePluginRefreshStep['status'], observing = false):
  WorkspacePluginRefreshStep => ({ surface, status, observing });

function setup(
  request: () => Promise<{ ok: true; data: number } | { ok: false; error: string }>,
  status: () => Promise<{ ok: true; data: WorkspacePluginRefreshStep[] } | { ok: false; error: string }>
) {
  const requestPluginRefresh = vi.fn(request);
  const workspacePluginRefreshSteps = vi.fn(status);
  initWorkspacePluginRefresh({ requestPluginRefresh, workspacePluginRefreshSteps }, notify);
  return { requestPluginRefresh, workspacePluginRefreshSteps };
}

beforeEach(() => {
  dom = new JSDOM(`<button id="workspaceRefreshPlugins" type="button"><i></i><span id="workspaceRefreshPluginsLabel"></span></button>
  <section id="workspaceRefreshProgress" hidden><strong id="workspaceRefreshTitle"></strong>
    <button id="workspaceRefreshClose" type="button"></button>
    <p id="workspaceRefreshSummary"></p><ol id="workspaceRefreshSteps"></ol></section>`);
  vi.stubGlobal('document', dom.window.document);
  button = dom.window.document.getElementById('workspaceRefreshPlugins') as HTMLButtonElement;
  notify = vi.fn<(message: string) => void>();
});
afterEach(() => {
  (document.getElementById('workspaceRefreshClose') as HTMLButtonElement).click();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  dom.window.close();
  vi.clearAllMocks();
});

it('opens the progress panel and renders only installed ChatGPT connectors with staggered steps', async () => {
  setup(async () => ({ ok: true, data: 3 }), async () => ({
    ok: true, data: [step('core', 'pending'), step('plugins', 'current')]
  }));
  expect(button.textContent).toBe('Refresh plugins');
  expect(button.title).toContain('ChatGPT');
  button.click();
  const panel = document.getElementById('workspaceRefreshProgress')!;
  await vi.waitFor(() => expect(panel.querySelectorAll('.workspace-refresh-step')).toHaveLength(2));
  expect(panel.hidden).toBe(false);
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(panel.textContent).toContain('1. Core');
  expect(panel.textContent).toContain('2. Plugins');
  expect(panel.textContent).not.toContain('Desktop');
  expect((panel.querySelectorAll('.workspace-refresh-step')[1] as HTMLElement).style.getPropertyValue('--step-index')).toBe('1');
  expect(panel.querySelector('.is-done .ph-check-circle')).not.toBeNull();
  expect(panel.querySelector('.is-active .ph-circle-notch')).not.toBeNull();
  expect(button.disabled).toBe(false);
  expect(notify).not.toHaveBeenCalled();
});

it('does not show a checkmark for a prior current receipt still being re-observed', () => {
  expect(workspaceRefreshOutcome(step('core', 'current', true))).toBe('pending');
  expect(workspaceRefreshOutcome(step('core', 'current', false))).toBe('done');
  expect(workspaceRefreshOutcome(step('core', 'refreshing'))).toBe('pending');
  expect(workspaceRefreshOutcome(step('core', 'manual'))).toBe('failed');
  expect(workspaceRefreshOutcome(step('core', 'failed'))).toBe('failed');
});

it('shows checked completion only after a refreshed provider snapshot confirms the current tools', async () => {
  const statuses = vi.fn()
    .mockResolvedValueOnce({ ok: true, data: [step('core', 'current', true)] })
    .mockResolvedValueOnce({ ok: true, data: [step('core', 'current', false)] });
  setup(async () => ({ ok: true, data: 1 }), statuses);
  button.click();
  await vi.waitFor(() => expect(document.querySelector('.workspace-refresh-step.is-active')).not.toBeNull());
  expect(document.querySelector('.workspace-refresh-step.is-done')).toBeNull();
  await vi.waitFor(() => expect(document.querySelector('.workspace-refresh-step.is-done')).not.toBeNull(), { timeout: 3500 });
  expect(statuses).toHaveBeenCalledTimes(2);
  expect(document.querySelector('#workspaceRefreshSummary')!.textContent).toContain('up to date');
  expect(document.querySelector('.is-done .ph-check-circle')).not.toBeNull();
});

it('shows manual or failed connections with a warning instead of a green check', async () => {
  setup(async () => ({ ok: true, data: 2 }), async () => ({
    ok: true, data: [step('core', 'current'), step('plugins', 'manual')]
  }));
  button.click();
  await vi.waitFor(() => expect(document.querySelectorAll('.workspace-refresh-step')).toHaveLength(2));
  expect(document.querySelector('.workspace-refresh-step.is-failed .ph-warning-circle')).not.toBeNull();
  expect(document.querySelector('#workspaceRefreshSummary')!.textContent).toContain('attention');
});

it('rejects repeated clicks while IPC request is outstanding and allows closing without a false result', async () => {
  let resolve!: (value: { ok: true; data: number }) => void;
  const { requestPluginRefresh, workspacePluginRefreshSteps } = setup(
    () => new Promise(done => { resolve = done; }), async () => ({ ok: true, data: [] })
  );
  button.click();
  expect(button.disabled).toBe(true);
  expect(button.getAttribute('aria-busy')).toBe('true');
  button.click();
  expect(requestPluginRefresh).toHaveBeenCalledOnce();
  document.getElementById('workspaceRefreshClose')!.click();
  resolve({ ok: true, data: 1 });
  await vi.waitFor(() => expect(button.disabled).toBe(false));
  expect(workspacePluginRefreshSteps).not.toHaveBeenCalled();
  expect(document.getElementById('workspaceRefreshProgress')!.hidden).toBe(true);
});

it('explains when no installed connector can be shown', async () => {
  setup(async () => ({ ok: true, data: 0 }), async () => ({ ok: true, data: [] }));
  button.click();
  await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce());
  expect(notify.mock.calls[0]![0]).toContain('No connected plugin tools');
  expect(document.getElementById('workspaceRefreshSteps')!.children).toHaveLength(0);
});

it('reports IPC failures and allows another request', async () => {
  const { requestPluginRefresh } = setup(vi.fn()
    .mockResolvedValueOnce({ ok: false, error: 'ledger unreadable' })
    .mockResolvedValueOnce({ ok: true, data: 0 }),
    async () => ({ ok: true, data: [] }));
  button.click();
  await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
  expect(notify.mock.calls[0]![0]).toContain('Could not request');
  button.click();
  await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(2));
  expect(requestPluginRefresh).toHaveBeenCalledTimes(2);
});
