import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Exercise the actual content-script Goal watcher, not a second reimplementation.
 * A five-minute timeout used to abandon the only owner of a finished Loop turn
 * while local tools were legitimately running, leaving "Answer settling" forever.
 */
const script = readFileSync(fileURLToPath(new URL('../extension/content.js', import.meta.url)), 'utf8');
const start = script.indexOf('  async function watchGoalTurn(ended, forTurn) {');
const end = script.indexOf('\n  /**\n   * Asks again about a turn', start);
if (start < 0 || end < 0) throw new Error('Goal watcher source boundary changed');
const watcherSource = script.slice(start, end);

function harness(toolDurationMs: number, abandonAtMs = Infinity) {
  let clock = 0;
  let busy = false;
  let draftCalls = 0;
  let phase = '';
  let alive = true;
  const context = {
    get goalBusy() { return busy; },
    set goalBusy(value: boolean) { busy = value; },
    get alive() { return alive; },
    conversationId: 'chat-A',
    epoch: 1,
    goalTurnId: 'turn-A',
    generating: false,
    nativeBusy: false,
    job: null,
    GOAL_POLL_MS: 1000,
    GOAL_STABLE_MS: 8000,
    Date: { now: () => clock },
    setGoalPhase(value: string) { phase = value; },
    finalAnswerText: () => 'completed answer',
    briefActivityMark: () => 0,
    briefSoFar: (_ended: unknown, previous: string) => previous,
    peekPendingTools: async () => clock < toolDurationMs ? 1 : 0,
    CLF_DOM: { generating: () => false },
    goalUsable: () => true,
    sleep: async () => {
      clock += 1000;
      if (clock >= abandonAtMs) alive = false;
      if (clock > 12 * 60_000) throw new Error('Goal watcher never finished');
    },
    requestGoalDraft: async () => { draftCalls++; },
    renderControl: () => {},
    injectStage: () => {}
  };
  const watcher = new Function('ctx', `with (ctx) { ${watcherSource}; return watchGoalTurn; }`)(context) as
    (ended: unknown, turnId: string) => Promise<void>;
  return {
    run: () => watcher({}, 'turn-A'),
    snapshot: () => ({ clock, busy, draftCalls, phase })
  };
}

describe('Goal/Loop page settling', () => {
  it('continues the same turn once after a tool runs longer than five minutes', async () => {
    const test = harness(6 * 60_000);
    await test.run();
    expect(test.snapshot().clock).toBeGreaterThanOrEqual(6 * 60_000 + 8000);
    expect(test.snapshot().draftCalls).toBe(1);
    expect(test.snapshot().busy).toBe(false);
  });

  it('never drafts while a tool remains active and the page leaves', async () => {
    const test = harness(Infinity, 6 * 60_000);
    await test.run();
    expect(test.snapshot().draftCalls).toBe(0);
    expect(test.snapshot().busy).toBe(false);
  });
});
