/** The fork alone supplies installable app updates. Upstream is a separate news feed. */
export const FORK_REPO = 'BrodXI/chat-on-steroids-with-my-twist';
export const UPSTREAM_REPO = 'totec448-spec/chat-on-steroids';
export const FORK_RELEASES_PAGE = `https://github.com/${FORK_REPO}/releases`;

export type ForkRelease = {
  tag: string;
  commit: string;
  /** Digests supplied by GitHub for the actual uploaded release assets. */
  digests: Map<string, string>;
};

export const safeReleaseTag = (tag: unknown): tag is string =>
  typeof tag === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(tag) && tag !== '.' && tag !== '..';
export const safeCommit = (sha: unknown): sha is string => typeof sha === 'string' && /^[0-9a-f]{40}$/i.test(sha);

type ApiRelease = { tag_name?: unknown; target_commitish?: unknown; name?: unknown;
  draft?: unknown; prerelease?: unknown; assets?: Array<{ name?: unknown; digest?: unknown }> };

const REQUEST_TIMEOUT = 15_000;
const headers = { accept: 'application/vnd.github+json', 'user-agent': 'chat-on-steroids-fork-updater' };

/**
 * Never infer a safe upgrade from a publication date or a version label.
 * GitHub confirms the release's exact commit descends from the commit bundled into this build.
 * This skips repackaged old versions, diverged experiments and the currently running release.
 * The list includes prereleases because this fork currently publishes signed-extension previews.
 */
export async function newestForkUpgrade(installedCommit: string, fetcher: typeof fetch = fetch): Promise<ForkRelease | null> {
  if (!safeCommit(installedCommit)) throw new Error('This build has no verified source commit; automatic fork updates are unavailable');
  const list = await fetcher(`https://api.github.com/repos/${FORK_REPO}/releases?per_page=30`, {
    headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT)
  });
  if (!list.ok) throw new Error(`Fork releases answered ${list.status}`);
  const raw: unknown = await list.json();
  if (!Array.isArray(raw)) throw new Error('Fork releases returned an invalid list');
  for (const row of raw.slice(0, 30) as ApiRelease[]) {
    if (row.draft === true || !safeReleaseTag(row.tag_name) || !safeCommit(row.target_commitish) ||
      typeof row.name === 'string' && /^SUPERSEDED\b/i.test(row.name)) continue;
    const commit = row.target_commitish.toLowerCase();
    if (commit === installedCommit.toLowerCase()) return null;
    const digests = new Map<string, string>();
    if (!Array.isArray(row.assets)) continue;
    for (const asset of row.assets) {
      if (typeof asset.name === 'string' && /^[\w.-]{1,150}$/.test(asset.name) &&
        typeof asset.digest === 'string' && /^sha256:[0-9a-f]{64}$/i.test(asset.digest)) {
        digests.set(asset.name, asset.digest.slice(7).toLowerCase());
      }
    }
    // Releases lacking an executable are documentation/test artifacts, not app updates.
    if (!digests.has('Chat-On-Steroids-Setup-x64.exe')) continue;
    const comparison = await fetcher(`https://api.github.com/repos/${FORK_REPO}/compare/${installedCommit}...${commit}`, {
      headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT)
    });
    if (!comparison.ok) throw new Error(`Fork commit comparison answered ${comparison.status}`);
    const relation = (await comparison.json()) as { status?: unknown; ahead_by?: unknown };
    if (relation.status === 'ahead' && typeof relation.ahead_by === 'number' && relation.ahead_by > 0) {
      return { tag: row.tag_name, commit, digests };
    }
  }
  return null;
}

/** Find the paired extension from the exact source commit running in this app.
 * Never fetch a moving latest extension: the bridge protocol may differ.
 */
export async function installedForkExtensionUrl(commit: string, browser: 'firefox' | 'chrome', fetcher: typeof fetch = fetch): Promise<string | null> {
  if (!safeCommit(commit)) return null;
  const response = await fetcher(`https://api.github.com/repos/${FORK_REPO}/releases?per_page=30`, {
    headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT)
  });
  if (!response.ok) throw new Error(`Fork releases answered ${response.status}`);
  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) return null;
  for (const row of rows.slice(0, 30) as ApiRelease[]) {
    if (!safeReleaseTag(row.tag_name) || !safeCommit(row.target_commitish) || row.target_commitish.toLowerCase() !== commit.toLowerCase() ||
      row.draft || !Array.isArray(row.assets)) continue;
    const asset = row.assets.find(item => typeof item.name === 'string' &&
      (browser === 'chrome' ? item.name === 'Chat-On-Steroids-Extension.zip'
        : item.name === 'Chat-On-Steroids-Firefox.xpi' || /^Chat-On-Steroids-Firefox-Signed-\d+\.\d+\.\d+\.\d+\.xpi$/.test(item.name)) &&
      typeof item.digest === 'string' && /^sha256:[0-9a-f]{64}$/i.test(item.digest));
    if (asset && typeof asset.name === 'string') {
      return `https://github.com/${FORK_REPO}/releases/download/${encodeURIComponent(row.tag_name)}/${asset.name}`;
    }
  }
  return null;
}
