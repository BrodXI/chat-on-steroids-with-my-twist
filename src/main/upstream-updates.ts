/** Official CoS releases are news only. They are NEVER app install/update sources. */
import { APP_VERSION } from './version.js';
import { UPSTREAM_REPO } from './fork-releases.js';
import { isNewer } from '../shared/types.js';
import { logWarn } from './logger.js';

export type UpstreamUpdate = { latest: string | null; checkedAt: number | null };
let status: UpstreamUpdate = { latest: null, checkedAt: null };
const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
let interval: ReturnType<typeof setInterval> | null = null;
const EVERY = 60 * 60_000;

export const upstreamUpdateStatus = (): UpstreamUpdate => ({ ...status });
export function onUpstreamUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function checkUpstreamRelease(fetcher: typeof fetch = fetch): Promise<void> {
  if (inFlight) return inFlight;
  const run = (async () => {
    try {
      const response = await fetcher(`https://api.github.com/repos/${UPSTREAM_REPO}/releases/latest`, {
        signal: AbortSignal.timeout(12_000), headers: { accept: 'application/vnd.github+json', 'user-agent': 'chat-on-steroids-fork-upstream-news' }
      });
      if (!response.ok) throw new Error(`upstream release API answered ${response.status}`);
      const result = (await response.json()) as { tag_name?: unknown };
      const tag = result.tag_name;
      if (typeof tag !== 'string' || !/^v?\d+\.\d+\.\d+$/.test(tag)) throw new Error('upstream release has no valid version');
      const version = tag.replace(/^v/, '');
      status = { latest: isNewer(version, APP_VERSION) ? version : null, checkedAt: Date.now() };
      for (const listener of listeners) listener();
    } catch (err) {
      // Banner failures must never affect fork download/install status or normal app startup.
      logWarn(`official upstream release check unavailable: ${(err as Error).message}`);
    }
  })().finally(() => { if (inFlight === run) inFlight = null; });
  inFlight = run;
  return run;
}
export function startUpstreamReleaseChecks(): void {
  if (interval) clearInterval(interval);
  interval = setInterval(() => void checkUpstreamRelease(), EVERY);
  interval.unref();
  void checkUpstreamRelease();
}
export function resetUpstreamReleaseForTests(): void {
  if (interval) clearInterval(interval);
  interval = null; inFlight = null;
  status = { latest: null, checkedAt: null }; listeners.clear();
}
