import { afterEach, beforeEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { defaultConfig, initConfigPath, saveConfig } from '../src/main/config.js';
import { initDurableStore, resetDurableForTests } from '../src/main/durable.js';
import { createSession, initSessionStore, resetSessionStoreForTests } from '../src/main/session/store.js';
import { noteChatgptProjects, chatgptProjectChoices } from '../src/main/chatgpt-project-catalog.js';
import { addGitHubProject, assignSessionProject, getProject, getSessionProject, listProjects, projectWorkspace, removeProject, syncChatgptProjects, validateProjectContext } from '../src/main/projects.js';
import { parseGitHubRepository } from '../src/main/github-project.js';
import { prepareSessionPrompt, prepareSkillFollowup } from '../src/main/session/prompt.js';
import { validateNewRoot } from '../src/main/sandbox.js';

const id = (digit: string) => `g-p-${digit.repeat(32)}`;
let directory: string;
let approved: string;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cos-project-sync-'));
  approved = path.join(directory, 'approved');
});

afterEach(async () => {
  resetSessionStoreForTests();
  resetDurableForTests();
  await fs.rm(directory, { recursive: true, force: true });
});

async function setup() {
  await fs.mkdir(path.join(directory, 'approved'), { recursive: true });
  approved = await validateNewRoot(path.join(directory, 'approved'), []);
  initConfigPath(directory);
  initDurableStore(directory);
  initSessionStore(directory);
  await saveConfig({ ...defaultConfig(), roots: [{ name: 'work', path: approved }] });
}

it('imports only selected ChatGPT Projects as linked, uniquely named CoS folders', async () => {
  await setup();
  await noteChatgptProjects([{ id: id('a'), name: 'Research' }, { id: id('b'), name: 'Design / <2026>?*' }]);
  const synced = await syncChatgptProjects(approved, [id('b')]);
  expect(synced.created).toHaveLength(1);
  expect(synced.updated).toHaveLength(0);
  const project = synced.created[0]!;
  expect(project.name).toBe('Design / <2026>?*');
  expect(path.dirname(project.path)).toBe(approved);
  expect(path.basename(project.path)).toMatch(/^[^<>:"/\\|?*]+-b{8}$/);
  expect(project.chatgpt).toMatchObject({ state: 'linked', id: id('b') });
  expect(project.syncedFromChatgpt).toBe(true);
  expect((await fs.stat(project.path)).isDirectory()).toBe(true);
  expect((await chatgptProjectChoices()).find(row => row.id === id('b'))?.linkedTo?.id).toBe(project.id);
  expect(await listProjects()).toHaveLength(1);
});

it('sync all adds missing Projects, remains idempotent, and updates imported names only', async () => {
  await setup();
  await noteChatgptProjects([{ id: id('a'), name: 'One' }, { id: id('b'), name: 'Two' }]);
  const first = await syncChatgptProjects(approved, [id('a')]);
  const all = await syncChatgptProjects(approved);
  expect(all.created.map(row => row.chatgpt?.state === 'linked' && row.chatgpt.id)).toEqual([id('b')]);
  expect(all.skipped).toBe(1);
  expect((await syncChatgptProjects(approved)).skipped).toBe(2);
  await noteChatgptProjects([{ id: id('a'), name: 'One renamed' }, { id: id('b'), name: 'Two' }]);
  const renamed = await syncChatgptProjects(approved);
  expect(renamed.created).toHaveLength(0);
  expect(renamed.updated).toHaveLength(1);
  expect(renamed.updated[0]?.id).toBe(first.created[0]?.id);
  expect(renamed.updated[0]?.name).toBe('One renamed');
  expect(await listProjects()).toHaveLength(2);
});

it('refuses unlisted or cross-workspace ids and never overwrites existing folders', async () => {
  await setup();
  await noteChatgptProjects([{ id: id('a'), name: 'A' }], Date.now(), 'team-one');
  await noteChatgptProjects([{ id: id('b'), name: 'B' }], Date.now(), 'team-two');
  await expect(syncChatgptProjects(approved, [id('a')])).rejects.toThrow(/current workspace/);
  const already = path.join(approved, `B-${'b'.repeat(8)}`);
  await fs.mkdir(already);
  await fs.writeFile(path.join(already, 'keep.txt'), 'untouched');
  await expect(syncChatgptProjects(approved)).rejects.toThrow();
  expect(await fs.readFile(path.join(already, 'keep.txt'), 'utf8')).toBe('untouched');
  expect(await listProjects()).toEqual([]);
});

it('does not silently re-add a project deliberately removed from the sidebar', async () => {
  await setup();
  await noteChatgptProjects([{ id: id('a'), name: 'A' }]);
  const project = (await syncChatgptProjects(approved)).created[0]!;
  await removeProject(project.id);
  const again = await syncChatgptProjects(approved);
  expect(again.created).toHaveLength(0);
  expect(again.skipped).toBe(1);
  expect((await getProject(project.id))?.ungrouped).toBe(true);
});

it('normalizes only GitHub HTTPS and SSH repository roots without credentials', () => {
  expect(parseGitHubRepository('https://github.com/Owner/re.po.git')).toEqual({
    url: 'https://github.com/Owner/re.po', name: 're.po'
  });
  expect(parseGitHubRepository('git@github.com:Owner/Repo.git')).toEqual({
    url: 'https://github.com/Owner/Repo', name: 'Repo'
  });
  for (const bad of [
    'file:///tmp/repo', 'ext::evil', 'https://user:token@github.com/Owner/Repo',
    'https://github.com.attacker.invalid/Owner/Repo', 'https://github.com/Owner/Repo/tree/main',
    'https://github.com/Owner/Repo?token=abc', 'git@example.com:Owner/Repo',
    'https://github.com/Owner/..', 'C:\\private\\repo'
  ]) expect(() => parseGitHubRepository(bad)).toThrow();
});

it('creates a GitHub tool-only project without cloning, approving roots, or touching repository files', async () => {
  await setup();
  const before = await fs.readdir(approved);
  const project = await addGitHubProject('git@github.com:Owner/Repo.git');
  expect(project.github).toBe('https://github.com/Owner/Repo');
  expect(project.githubOnly).toBe(true);
  expect(project.chatgpt).toBeUndefined();
  expect(project.path).toBe(project.github);
  expect(await fs.readdir(approved)).toEqual(before);
  expect((await addGitHubProject('https://github.com/owner/repo')).id).toBe(project.id);
  expect(await listProjects()).toHaveLength(1);
  await validateProjectContext(project.id);
  await expect(projectWorkspace(project.id)).rejects.toThrow(/no local folder/);
  const session = await createSession({ title: 'Cloud repo', conversationId: 'cloud-test-chat' });
  await assignSessionProject(session.id, project.id);
  expect(await getSessionProject(session.id)).toBeNull();
  const opening = await prepareSessionPrompt('Read the README', { sessionId: session.id });
  const directlySelected = await prepareSessionPrompt('Open issues', { projectId: project.id });
  expect(directlySelected).toContain('GitHub-only CoS project: https://github.com/Owner/Repo');
  expect(opening).toContain('GitHub-only CoS project: https://github.com/Owner/Repo');
  expect(opening).toContain('connected GitHub tool/plugin');
  expect(opening).toContain('Never clone, download, or use the local filesystem');
  expect(opening).not.toContain('Selected project directory:');
  expect((await prepareSkillFollowup('Continue', 'Continue', undefined, { sessionId: session.id }, true))).toContain('GitHub-only CoS project');
  expect(await fs.readdir(approved)).toEqual(before);
});

it('refuses invalid repository URLs and does not create projects or folders', async () => {
  await setup();
  expect(() => addGitHubProject('https://user:password@github.com/Owner/Repo')).toThrow();
  expect(() => addGitHubProject('https://notgithub.example/Owner/Repo')).toThrow();
  expect(await fs.readdir(approved)).toEqual([]);
  expect(await listProjects()).toEqual([]);
});

it('restores an ungrouped GitHub project without creating a second record', async () => {
  await setup();
  const project = await addGitHubProject('https://github.com/Owner/Repo');
  await removeProject(project.id);
  const restored = await addGitHubProject('https://github.com/owner/repo.git');
  expect(restored.id).toBe(project.id);
  expect(restored.ungrouped).toBeUndefined();
  expect(await listProjects()).toHaveLength(1);
  expect(await fs.readdir(approved)).toEqual([]);
});
