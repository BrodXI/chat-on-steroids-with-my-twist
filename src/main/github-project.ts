export interface GitHubRepository {
  /** Canonical, credential-free URL used by the connected GitHub tool. */
  url: string;
  name: string;
}

/** Accept only a GitHub repository root, never a local path or a credential-bearing URL. */
export function parseGitHubRepository(value: string): GitHubRepository {
  const input = value.trim();
  let owner: string;
  let repo: string;
  const sshMatch = /^git@github\.com:([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)$/i.exec(input);
  if (sshMatch) {
    owner = sshMatch[1]!;
    repo = sshMatch[2]!;
  } else {
    let parsed: URL;
    try { parsed = new URL(input); }
    catch { throw new Error('Enter a GitHub repository URL, for example https://github.com/owner/repo'); }
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
  return { url: `https://github.com/${owner}/${repo}`, name: repo };
}
