import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let dom: JSDOM;
beforeEach(() => {
  vi.resetModules();
  dom = new JSDOM(readFileSync('src/renderer/index.html', 'utf8'), { url: 'https://local.test/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, Event: dom.window.Event });
});
afterEach(() => dom.window.close());

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const ok = <T>(data: T) => Promise.resolve({ ok: true as const, data });
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const choices = [
  { id: 'g-p-' + 'a'.repeat(32), name: 'Research', linkedTo: null },
  { id: 'g-p-' + 'b'.repeat(32), name: 'Design', linkedTo: null },
  { id: 'g-p-' + 'c'.repeat(32), name: 'Already linked', linkedTo: { id: 'local', name: 'Local project' } }
];

async function dialogs() {
  const { initProjectImportDialogs } = await import('../src/renderer/project-import-dialogs.js');
  const api = {
    chatgptProjectChoices: vi.fn(() => ok(choices)),
    syncChatgptProjects: vi.fn(() => ok({ created: [], updated: [], skipped: 3 })),
    addGitHubProject: vi.fn(() => ok({ id: 'cloud', name: 'Repo', path: 'https://github.com/Owner/Repo', githubOnly: true, createdAt: 1 }))
  };
  const githubAdded = vi.fn(), chatgptSynced = vi.fn();
  const manager = initProjectImportDialogs(api as any, { githubAdded, chatgptSynced });
  return { api, manager, githubAdded, chatgptSynced };
}

it('shows the current workspace Projects and selectively syncs only checked ids', async () => {
  const { api, manager, chatgptSynced } = await dialogs();
  await manager.openChatgpt();
  const boxes = [...document.querySelectorAll<HTMLInputElement>('#chatgptSyncList input[type=checkbox]')];
  expect(boxes).toHaveLength(3);
  expect(boxes.map(box => box.checked)).toEqual([true, true, false]);
  boxes[1]!.click();
  $('chatgptSyncSelected').click();
  await settle();
  expect(api.syncChatgptProjects).toHaveBeenCalledWith([choices[0]!.id]);
  expect(chatgptSynced).toHaveBeenCalledOnce();
});

it('Sync all includes every listed project even when selected checkboxes differ', async () => {
  const { api, manager } = await dialogs();
  await manager.openChatgpt();
  $<HTMLInputElement>('chatgptSyncSearch').value = 'Design';
  $<HTMLInputElement>('chatgptSyncSearch').dispatchEvent(new dom.window.Event('input'));
  expect(document.querySelectorAll('#chatgptSyncList input[type=checkbox]')).toHaveLength(1);
  $('chatgptSyncAll').click();
  await settle();
  expect(api.syncChatgptProjects).toHaveBeenCalledWith(undefined);
});

it('creates a cloud GitHub project from its URL without choosing a folder', async () => {
  const { api, manager, githubAdded } = await dialogs();
  manager.openGithub();
  expect(api.addGitHubProject).not.toHaveBeenCalled();
  expect($('githubProjectSubmit').textContent).toMatch(/cloud project/i);
  $<HTMLInputElement>('githubProjectUrl').value = 'git@github.com:Owner/Repo.git';
  $('githubProjectForm').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await settle();
  expect(api.addGitHubProject).toHaveBeenCalledWith('git@github.com:Owner/Repo.git');
  expect(githubAdded).toHaveBeenCalledOnce();
});
