import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { FORK_REPO, FORK_RELEASES_PAGE, installedForkExtensionUrl, newestForkUpgrade, safeReleaseTag } from '../src/main/fork-releases.js';

const CURRENT = 'a'.repeat(40), LATER = 'b'.repeat(40), OLDER = 'c'.repeat(40);
const digest = createHash('sha256').update('installer').digest('hex');
const asset = { name: 'Chat-On-Steroids-Setup-x64.exe', digest: `sha256:${digest}` };
const release = (tag: string, commit: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag, target_commitish: commit, draft: false, prerelease: true,
  assets: [asset, { name: 'Chat-On-Steroids-Extension.zip', digest: `sha256:${digest}` }], ...extra
});

function github(rows: unknown[], status = 'ahead', ahead = 1) {
  const calls: string[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    return new Response(JSON.stringify(url.includes('/compare/') ? { status, ahead_by: ahead } : rows), { status: 200 });
  });
  return { calls, fetcher: fetcher as unknown as typeof fetch };
}

describe('fork updater release selection', () => {
  it('checks only the fork and accepts a later descendant preview with GitHub asset digests', async () => {
    const { fetcher, calls } = github([release('cos-next-preview-20261111', LATER)]);
    const found = await newestForkUpgrade(CURRENT, fetcher);
    expect(found?.tag).toBe('cos-next-preview-20261111');
    expect(found?.commit).toBe(LATER);
    expect(found?.digests.get(asset.name)).toBe(digest);
    expect(calls).toEqual([
      `https://api.github.com/repos/${FORK_REPO}/releases?per_page=30`,
      `https://api.github.com/repos/${FORK_REPO}/compare/${CURRENT}...${LATER}`
    ]);
    expect(FORK_RELEASES_PAGE).toContain('BrodXI');
  });

  it.each(['behind', 'diverged', 'identical'])('never installs a %s release', async status => {
    const { fetcher } = github([release('cos-older', OLDER)], status);
    expect(await newestForkUpgrade(CURRENT, fetcher)).toBeNull();
  });

  it('does not offer the running build, skipped superseded previews, drafts, invalid tags, or unsigned installer metadata', async () => {
    const { fetcher, calls } = github([
      release('cos-old-preview', OLDER, { name: 'SUPERSEDED: old preview' }),
      release('../escape', LATER),
      release('cos-draft', LATER, { draft: true }),
      release('cos-no-digest', LATER, { assets: [{ name: asset.name, digest: null }] }),
      release('cos-running', CURRENT)
    ]);
    expect(await newestForkUpgrade(CURRENT, fetcher)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('refuses unknown source revision and malformed API output rather than guessing an update', async () => {
    const { fetcher } = github([]);
    await expect(newestForkUpgrade('not-a-commit', fetcher)).rejects.toThrow(/verified source commit/);
    expect(safeReleaseTag('../escape')).toBe(false);
    expect(safeReleaseTag('cos-next-preview')).toBe(true);
    const bad = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    await expect(newestForkUpgrade(CURRENT, bad)).rejects.toThrow(/invalid list/);
  });

  it('recovers only the Chrome and Mozilla-signed Firefox extensions from the installed source commit', async () => {
    const row = release('cos-signed-preview', CURRENT, { assets: [
      { name: 'Chat-On-Steroids-Extension.zip', digest: `sha256:${digest}` },
      { name: 'Chat-On-Steroids-Firefox-Signed-2.1.52.52.xpi', digest: `sha256:${digest}` }
    ] });
    const { fetcher } = github([row]);
    expect(await installedForkExtensionUrl(CURRENT, 'chrome', fetcher))
      .toBe(`https://github.com/${FORK_REPO}/releases/download/cos-signed-preview/Chat-On-Steroids-Extension.zip`);
    expect(await installedForkExtensionUrl(CURRENT, 'firefox', fetcher))
      .toBe(`https://github.com/${FORK_REPO}/releases/download/cos-signed-preview/Chat-On-Steroids-Firefox-Signed-2.1.52.52.xpi`);
    expect(await installedForkExtensionUrl(OLDER, 'chrome', fetcher)).toBeNull();
  });
});
