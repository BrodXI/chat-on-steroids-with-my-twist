import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { rawPromises as fs } from './rawfs.js';
import { getConfig } from './config.js';
import { resolvePath } from './sandbox.js';
import { runGit } from './project-git.js';
import { addProject } from './projects.js';
import type { LocalProject } from '../shared/projects.js';

export interface GitHubRepository {
  /** HTTPS address safe for display and open-in-browser. Never contains credentials. */
  url: string;
  /** Git transport to use. Private repositories may use the user's existing SSH agent. */
  cloneUrl: string;
  name: string;
}

/** Accept ONLY a GitHub repository root, not a local path, arbitrary Git transport or shell URL. */
export function parseGitHubRepository(value: string): GitHubRepository {
  const input = value.trim();
  let owner: string;
  let repo: string;
  let ssh = false;
  const sshMatch = /^git@github\.com:([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)$/i.exec(input);
  if (sshMatch) {
    owner = sshMatch[1]!;
    repo = sshMatch[2]!;
    ssh = true;
  } else {
    let parsed: URL;
    try { parsed = new URL(input); }
    catch { throw new Error('Enter a GitHub repository HTTPS or git@github.com SSH URL'); }
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.username || parsed.password ||
      parsed.port || parsed.search || parsed.hash) throw new Error('Only GitHub repository HTTPS or SSH URLs are supported');
    const match = /^\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)\/?$/.exec(parsed.pathname);
    if (!match) throw new Error('Enter a repository URL, for example https://github.com/owner/repo');
    owner = match[1]!;
    repo = match[2]!;
  }
  repo = repo.replace(/\.git$/i, '');
  if (!repo || repo === '.' || repo === '..' || owner.startsWith('-') || owner.endsWith('-') ||
      owner.length > 39 || repo.length > 100 || repo.endsWith('.')) {
    throw new Error('Invalid GitHub repository name');
  }
  return {
    url: `https://github.com/${owner}/${repo}`,
    cloneUrl: ssh ? `git@github.com:${owner}/${repo}.git` : `https://github.com/${owner}/${repo}.git`,
    name: repo
  };
}

/**
 * Clone into a new directory inside an explicitly approved folder, then register a CoS Project.
 * No arbitrary hosts, credentials in URLs, local transports, existing destinations or shell calls.
 * A failed clone cannot leave behind an imported project or overwrite a user's workspace.
 */
export async function cloneGitHubProject(parentFolder: string, repositoryUrl: string,
  deps: { git?: typeof runGit } = {}): Promise<LocalProject> {
  const repository = parseGitHubRepository(repositoryUrl);
  const parent = await resolvePath(getConfig().roots, parentFolder);
  if (!(await fs.stat(parent.real)).isDirectory()) throw new Error('Choose a destination folder');
  const destination = path.join(parent.real, repository.name);
  const exists = await fs.lstat(destination).then(() => true, (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return false;
    throw error;
  });
  if (exists) throw new Error('A folder with that repository name already exists. Choose another destination.');

  const temporaryName = `.cos-clone-${randomUUID()}`;
  const temporary = path.join(parent.real, temporaryName);
  try {
    const result = await (deps.git ?? runGit)(parent.real,
      ['-c', 'core.hooksPath=/dev/null', 'clone', '--', repository.cloneUrl, temporaryName], 16 * 1024,
      { timeoutMs: 240_000, env: { GIT_TERMINAL_PROMPT: '0' } });
    if (result.code !== 0) throw new Error(`GitHub clone failed: ${result.stderr || 'Check repository access and SSH/HTTPS authentication'}`);
    await fs.rename(temporary, destination);
    return await addProject(destination, { chatgpt: 'later', github: repository.url });
  } finally {
    // Failed clones are only ever cleaned from our unique temporary path, never user folders.
    await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined);
  }
}
