import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

it('places the manual refresh action at the top of Workspace, not on the plugin list alone', () => {
  const html = readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8');
  const doc = new JSDOM(html).window.document;
  const workspace = doc.querySelector('[data-panel="home"] .workspace-page-head');
  const button = workspace?.querySelector<HTMLButtonElement>('#workspaceRefreshPlugins');
  expect(button?.tagName).toBe('BUTTON');
  expect(button?.type).toBe('button');
  expect(button?.querySelector('.ph-arrow-clockwise')).not.toBeNull();
  expect(button?.textContent).toContain('Refresh plugins');
  expect(doc.querySelectorAll('#workspaceRefreshPlugins')).toHaveLength(1);
});
