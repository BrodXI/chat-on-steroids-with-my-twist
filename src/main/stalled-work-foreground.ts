/**
 * Presentation-only fallback for a ChatGPT task that has stopped making progress.
 *
 * A forced reveal never grants recovery, reload, Stop or Send authority. Those remain
 * the existing source-locked browser and durable-input decisions.
 */
export const WORK_NO_PROGRESS_REVEAL_MS = 10 * 60_000;
export const FOREGROUND_REVEAL_RETRY_MS = 60_000;
export const FOREGROUND_REVEAL_MAX_ATTEMPTS = 2;

export function workHasBeenQuietLongEnough(
  now: number,
  lastEvidenceAt: number,
  requiredMs = WORK_NO_PROGRESS_REVEAL_MS
): boolean {
  return Number.isFinite(now) && Number.isFinite(lastEvidenceAt) &&
    lastEvidenceAt > 0 && now >= lastEvidenceAt + requiredMs;
}

type Attempt = {
  episode: string;
  attempts: number;
  at: number;
  state: 'pending' | 'shown' | 'failed';
};

/**
 * At most two foreground attempts for one exact source episode. A successful
 * reveal is never repeated; a failed one can retry once after a quiet minute.
 * A newer source episode gets a fresh budget without a global permanent latch.
 */
export class StalledWorkForegroundGate {
  private readonly attempts = new Map<string, Attempt>();

  claim(conversationId: string, episode: string, now = Date.now()): boolean {
    if (!conversationId || !episode || !Number.isFinite(now)) return false;
    const prior = this.attempts.get(conversationId);
    if (prior?.episode === episode && (prior.state !== 'failed' ||
        prior.attempts >= FOREGROUND_REVEAL_MAX_ATTEMPTS ||
        now - prior.at < FOREGROUND_REVEAL_RETRY_MS)) return false;
    const next: Attempt = {
      episode,
      attempts: prior?.episode === episode ? prior.attempts + 1 : 1,
      at: now,
      state: 'pending'
    };
    // Map order tracks the most recently used episode, bounding process memory.
    this.attempts.delete(conversationId);
    this.attempts.set(conversationId, next);
    if (this.attempts.size > 500) this.attempts.delete(this.attempts.keys().next().value!);
    return true;
  }

  finish(conversationId: string, episode: string, shown: boolean): void {
    const current = this.attempts.get(conversationId);
    if (current?.episode === episode && current.state === 'pending') {
      current.state = shown ? 'shown' : 'failed';
    }
  }

  clear(): void { this.attempts.clear(); }
}
