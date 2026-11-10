import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const script = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');
const start = script.indexOf('  let recordedHandoffProbe = null;');
const end = script.indexOf('  async function maybeResumePendingCompaction', start);
if (start < 0 || end < 0) throw new Error('Recorded handoff recovery not found');
const probeSource = script.slice(start, end);

function harness() {
  let clock = 1000;
  const calls: any[] = [];
  const pending = { stage: 'handoff-pending', token: 'abc0123456789_xyz',
    sourceSend: { state: 'sent', messageId: 'exact-source' } };
  const context = {
    alive: true, epoch: 1, conversationId: 'chat-A', job: pending as any,
    CLF_DOM: { conversationId: () => context.conversationId },
    Date: { now: () => clock },
    nativePhase: 'waiting', localError: '', renderControl: () => {},
    ask: async (message: any) => { calls.push(message); return { ok: true, data: { stored: false } } as any; }
  };
  const probe = new Function('ctx', `with (ctx) { ${probeSource}; return recoverRecordedHandoff; }`)(context) as
    (id: string, epoch: number) => Promise<boolean>;
  return { context, calls, run: () => probe('chat-A', 1), advance: (ms: number) => { clock += ms; } };
}

describe('recover a saved handoff without a mounted Fiber marker', () => {
  it('uses only the durable sent source ID and never types a new prompt', async () => {
    const h = harness();
    h.context.ask = async message => {
      h.calls.push(message);
      return { ok: true, data: { stored: true, job: { stage: 'opening' } } };
    };
    expect(await h.run()).toBe(true);
    expect(h.calls).toEqual([{ type: 'compact', conversationId: 'chat-A', token: 'abc0123456789_xyz',
      sourceMessageId: 'exact-source' }]);
    expect(h.context.job.stage).toBe('opening');
  });

  it('keeps a not-yet-recorded response pending and retries with a bounded cadence', async () => {
    const h = harness();
    expect(await h.run()).toBe(false);
    expect(await h.run()).toBe(false);
    expect(h.calls).toHaveLength(1);
    h.advance(10_000);
    expect(await h.run()).toBe(false);
    expect(h.calls).toHaveLength(2);
  });

  it('does not probe a source whose native Send has not been accepted', async () => {
    const h = harness();
    h.context.job.sourceSend.state = 'dispatched-unresolved';
    expect(await h.run()).toBe(false);
    expect(h.calls).toHaveLength(0);
  });

  it('discards a stale reply after navigation or a ticket replacement', async () => {
    const h = harness();
    h.context.ask = async () => {
      h.context.epoch = 2;
      h.context.conversationId = 'chat-B';
      h.context.job = { stage: 'handoff-pending', token: 'new-ticket' };
      return { ok: true, data: { stored: true, job: { stage: 'opening' } } };
    };
    expect(await h.run()).toBe(false);
    expect(h.context.job.token).toBe('new-ticket');
  });
});
