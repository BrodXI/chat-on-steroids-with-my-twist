import { describe, expect, it } from 'vitest';
import {
  FOREGROUND_GLOBAL_FOCUS_COOLDOWN_MS,
  FOREGROUND_REVEAL_MAX_ATTEMPTS,
  FOREGROUND_REVEAL_RETRY_MS,
  StalledWorkForegroundGate,
  WORK_NO_PROGRESS_REVEAL_MS,
  workHasBeenQuietLongEnough
} from '../src/main/stalled-work-foreground.js';

describe('stalled Work tab foreground fallback', () => {
  it('requires ten minutes without progress rather than treating a live poll as new work', () => {
    const at = 100_000;
    expect(workHasBeenQuietLongEnough(at + WORK_NO_PROGRESS_REVEAL_MS - 1, at)).toBe(false);
    expect(workHasBeenQuietLongEnough(at + WORK_NO_PROGRESS_REVEAL_MS, at)).toBe(true);
    expect(workHasBeenQuietLongEnough(at + WORK_NO_PROGRESS_REVEAL_MS, at + 1)).toBe(false);
    expect(workHasBeenQuietLongEnough(at, 0)).toBe(false);
    expect(workHasBeenQuietLongEnough(NaN, at)).toBe(false);
    expect(workHasBeenQuietLongEnough(at, Infinity)).toBe(false);
  });

  it('allows one reveal while pending or after success for the same episode', () => {
    const gate = new StalledWorkForegroundGate();
    expect(gate.claim('chat-a', 'turn-1', 1000)).toBe(true);
    expect(gate.claim('chat-a', 'turn-1', 2000)).toBe(false);
    gate.finish('chat-a', 'turn-1', true);
    expect(gate.claim('chat-a', 'turn-1', 999_999)).toBe(false);
    expect(gate.claim('chat-a', 'turn-2', 1_000_000)).toBe(true);
  });

  it('retries a failed reveal only after a quiet minute and stops after two failures', () => {
    const gate = new StalledWorkForegroundGate();
    const first = 100_000;
    expect(gate.claim('chat-a', 'repair-1', first)).toBe(true);
    gate.finish('chat-a', 'repair-1', false);
    expect(gate.claim('chat-a', 'repair-1', first + FOREGROUND_REVEAL_RETRY_MS - 1)).toBe(false);
    expect(gate.claim('chat-a', 'repair-1', first + FOREGROUND_REVEAL_RETRY_MS)).toBe(true);
    gate.finish('chat-a', 'repair-1', false);
    expect(gate.claim('chat-a', 'repair-1', first + 200_000)).toBe(false);
    expect(FOREGROUND_REVEAL_MAX_ATTEMPTS).toBe(2);
  });

  it('ignores late acknowledgements from the old episode and does not combine chats', () => {
    const gate = new StalledWorkForegroundGate();
    const next = 100 + FOREGROUND_GLOBAL_FOCUS_COOLDOWN_MS;
    expect(gate.claim('chat-a', 'old', 100)).toBe(true);
    expect(gate.claim('chat-a', 'new', next)).toBe(true);
    gate.finish('chat-a', 'old', true);
    expect(gate.claim('chat-a', 'new', next + 1)).toBe(false);
    expect(gate.claim('chat-b', 'old', next + 1)).toBe(false);
    expect(gate.claim('chat-b', 'old', next + FOREGROUND_GLOBAL_FOCUS_COOLDOWN_MS)).toBe(true);
    gate.finish('chat-a', 'new', false);
    expect(gate.claim('chat-a', 'new', next + FOREGROUND_REVEAL_RETRY_MS)).toBe(true);
  });

  it('bounds idle bookkeeping to 500 distinct chats', () => {
    const gate = new StalledWorkForegroundGate();
    for (let id = 0; id < 501; id++) {
      expect(gate.claim('chat-' + id, 'old', 100 + id * FOREGROUND_GLOBAL_FOCUS_COOLDOWN_MS)).toBe(true);
    }
    // The oldest chat was pruned and may use its now-untracked episode again.
    const later = 100 + 501 * FOREGROUND_GLOBAL_FOCUS_COOLDOWN_MS;
    expect(gate.claim('chat-0', 'old', later)).toBe(true);
    gate.clear();
    expect(gate.claim('chat-500', 'old', later + 1)).toBe(true);
  });
});
