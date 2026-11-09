import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

it('places the manual progress panel under the Workspace refresh button', () => {
  const html = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
  const doc = new JSDOM(html).window.document;
  const workspace = doc.querySelector('[data-panel="home"] .workspace-page-head');
  const button = workspace?.querySelector<HTMLButtonElement>('#workspaceRefreshPlugins');
  expect(button?.tagName).toBe('BUTTON');
  expect(button?.type).toBe('button');
  expect(button?.querySelector('.ph-arrow-clockwise')).not.toBeNull();
  expect(button?.textContent).toContain('Refresh plugins');
  expect(doc.querySelectorAll('#workspaceRefreshPlugins')).toHaveLength(1);

  const panel = workspace?.querySelector('#workspaceRefreshProgress');
  expect(button?.getAttribute('aria-controls')).toBe('workspaceRefreshProgress');
  expect(button?.getAttribute('aria-expanded')).toBe('false');
  expect(panel?.getAttribute('role')).toBe('region');
  expect(panel?.hasAttribute('hidden')).toBe(true);
  expect(panel?.querySelector('ol#workspaceRefreshSteps[aria-live="polite"]')).not.toBeNull();
  expect(panel?.querySelector('button#workspaceRefreshClose')).not.toBeNull();
});

it('stagger-fades each connector and respects reduced-motion preferences', () => {
  const css = readFileSync(new URL('../src/renderer/settings.css', import.meta.url), 'utf8');
  expect(css).toContain('@keyframes workspace-refresh-pop');
  expect(css).toContain('@keyframes workspace-refresh-step-in');
  expect(css).toContain('var(--step-index, 0) * 220ms');
  expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  expect(css).toContain('.workspace-refresh-progress[hidden] { display: none; }');
});
