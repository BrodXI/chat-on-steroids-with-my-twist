import { readFileSync, readdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';

it('places one Windows-only administrator switch at the bottom of Workspace Permissions', () => {
  const dom = new JSDOM(readFileSync(new URL('../src/renderer/index.html', import.meta.url), 'utf8'));
  try {
    const { document } = dom.window;
    const section = document.querySelector<HTMLElement>('.workspace-permissions > .settings-surface')!;
    const admin = document.getElementById('launchAsAdministratorRow')!;
    expect(section.lastElementChild).toBe(admin);
    expect(admin.hidden).toBe(true);
    expect(admin.querySelector('h3')?.textContent).toBe('Administrator');
    const switches = document.querySelectorAll<HTMLInputElement>('#launchAsAdministrator');
    expect(switches).toHaveLength(1);
    expect(admin.contains(switches[0]!)).toBe(true);
    expect(switches[0]!.checked).toBe(false);
    expect(admin.textContent).toContain('Windows UAC');
    expect(admin.textContent).toContain('system registry changes, software installation, and elevated PowerShell');
    expect(admin.textContent).toContain('cannot be restricted separately');
  } finally {
    dom.window.close();
  }
});

it('localizes the Administrator title and elevation warning in every supported non-English locale', () => {
  const locales = new URL('../src/renderer/locales/', import.meta.url);
  const warning = 'Administrator access includes system registry changes, software installation, and elevated PowerShell. These cannot be restricted separately in an elevated app. Turn this off and fully quit and reopen CoS normally to remove elevation.';
  for (const file of readdirSync(locales).filter(name => name.endsWith('.json'))) {
    const translations = JSON.parse(readFileSync(new URL(file, locales), 'utf8'));
    expect(translations.Administrator, file).toBeTruthy();
    expect(translations[warning], file).toBeTruthy();
  }
});
