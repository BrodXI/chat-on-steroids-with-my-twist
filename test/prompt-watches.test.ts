import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { makeTempDir, removeTempDir } from './helpers.js';
import type { WatchDeps, WatchInputSnapshot } from '../src/main/prompt-watches.js';

const SESSION = '2026-11-11-watch-session';
const OTHER = '2026-11-11-other-session';
let dir: string;
beforeEach(async () => {
  vi.resetModules();
  dir = await makeTempDir('cos-prompt-watches-');
  (await import('../src/main/durable.js')).initDurableStore(dir);
});
afterEach(async () => { await removeTempDir(dir); });

async function setup() {
  const watches = await import('../src/main/prompt-watches.js');
  const queued: Array<{ id: string; sessionId: string; text: string; dueAt: number; scheduled: { scheduleId: string; dueAt: number; late: boolean } }> = [];
  const inputs: WatchInputSnapshot[] = [];
  const inspectGithub = vi.fn(async (): Promise<{ status: 'queued' | 'in_progress' | 'completed'; conclusion: string | null }> =>
    ({ status: 'in_progress', conclusion: null }));
  const deps: WatchDeps = {
    session: async id => ({ id, conversationId: 'this-conversation', activeTurnId: null }),
    enqueue: vi.fn(async input => { queued.push(input); inputs.push({ id: input.id, state: 'queued' }); }),
    inputs: async () => inputs,
    inspectGithub,
    log: vi.fn()
  };
  return { watches, deps, queued, inputs, inspectGithub };
}

it('sets an interval prompt with no immediate message, then queues one occurrence only', async () => {
  const { watches, deps, queued, inputs } = await setup();
  const start = 1_700_000_000_000;
  const first = await watches.createPromptWatch(SESSION, { kind: 'interval', prompt: 'Check the test', everyMinutes: 5 }, start);
  expect((await watches.createPromptWatch(SESSION, { kind: 'interval', prompt: 'Check the test', everyMinutes: 5 }, start)).id).toBe(first.id);
  await watches.runDuePromptWatches(start + 299_999, deps);
  expect(queued).toHaveLength(0);
  await watches.runDuePromptWatches(start + 300_000, deps);
  expect(queued).toEqual([expect.objectContaining({ text: 'Check the test', sessionId: SESSION,
    scheduled: { scheduleId: first.id, dueAt: start + 300_000, late: false } })]);
  await watches.runDuePromptWatches(start + 600_000, deps);
  expect(queued).toHaveLength(1); // The first message is still waiting in ChatGPT's outbox.
  inputs[0] = { id: queued[0]!.id, state: 'sent', deliveryProof: 'sent' };
  await watches.runDuePromptWatches(start + 600_000, deps);
  expect(queued).toHaveLength(2);
  expect(queued[1]!.id).not.toBe(queued[0]!.id);
});

it('polls GitHub silently, prompts the exact chat once on completed, and survives a restart', async () => {
  const { watches, deps, queued, inspectGithub } = await setup();
  const start = 1_700_000_000_000;
  const url = 'https://github.com/example/repo/actions/runs/12345';
  const watch = await watches.createPromptWatch(SESSION, { kind: 'github_run', url, pollMinutes: 2, prompt: 'Review the results' }, start);
  await watches.runDuePromptWatches(start, deps);
  expect(inspectGithub).toHaveBeenCalledTimes(1);
  expect(queued).toHaveLength(0);
  await watches.runDuePromptWatches(start + 60_000, deps);
  expect(inspectGithub).toHaveBeenCalledTimes(1);
  inspectGithub.mockResolvedValue({ status: 'completed', conclusion: 'failure' });
  await watches.runDuePromptWatches(start + 120_000, deps);
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({ sessionId: SESSION, text: expect.stringContaining('failure'), scheduled: { scheduleId: watch.id,
    dueAt: start + 120_000, late: false } });
  expect(queued[0]!.text).toContain('Review the results');
  expect((await watches.listPromptWatches(SESSION))[0]).toMatchObject({ active: false, outcome: 'failure' });
  vi.resetModules();
  (await import('../src/main/durable.js')).initDurableStore(dir);
  const restarted = await import('../src/main/prompt-watches.js');
  await restarted.runDuePromptWatches(start + 900_000, deps);
  expect(queued).toHaveLength(1);
});

it('keeps a deterministic event after an uncertain enqueue instead of sending twice', async () => {
  const { watches, deps, inputs, queued } = await setup();
  const start = 1_700_000_000_000;
  const watch = await watches.createPromptWatch(SESSION, { kind: 'interval', prompt: 'Still running?', everyMinutes: 1 }, start);
  const queue = deps.enqueue;
  deps.enqueue = vi.fn(async (input, options) => {
    await queue(input, options);
    throw new Error('Response lost after durable outbox write');
  });
  await watches.runDuePromptWatches(start + 60_000, deps);
  expect(queued).toHaveLength(1);
  expect((await watches.listPromptWatches(SESSION))[0]).toMatchObject({ pendingDueAt: start + 60_000 });
  deps.enqueue = vi.fn(async () => { throw new Error('Must not enqueue twice'); });
  await watches.runDuePromptWatches(start + 90_000, deps);
  expect(deps.enqueue).not.toHaveBeenCalled();
  const recovered = (await watches.listPromptWatches(SESSION))[0]!;
  expect(recovered.pendingDueAt).toBeUndefined();
  expect(recovered).toMatchObject({ lastInputId: inputs[0]!.id, nextDueAt: start + 150_000 });
  expect(queued[0]!.scheduled.scheduleId).toBe(watch.id);
});

it('retries a GitHub read error on its next poll without sending an unverified result', async () => {
  const { watches, deps, queued, inspectGithub } = await setup();
  const start = 1_700_000_000_000;
  await watches.createPromptWatch(SESSION, { kind: 'github_run', url: 'https://github.com/example/repo/actions/runs/777',
    pollMinutes: 5, prompt: 'Continue' }, start);
  inspectGithub.mockRejectedValueOnce(new Error('gh not authenticated'));
  await watches.runDuePromptWatches(start, deps);
  expect(queued).toHaveLength(0);
  expect((await watches.listPromptWatches(SESSION))[0]).toMatchObject({ lastError: 'unavailable', nextDueAt: start + 300_000 });
  await watches.runDuePromptWatches(start + 60_000, deps);
  expect(inspectGithub).toHaveBeenCalledTimes(1);
  await watches.runDuePromptWatches(start + 300_000, deps);
  expect(inspectGithub).toHaveBeenCalledTimes(2);
});

it('only cancels a watcher belonging to the same chat, and rejects unsafe GitHub URLs', async () => {
  const { watches, deps, queued } = await setup();
  const first = await watches.createPromptWatch(SESSION, { kind: 'interval', prompt: 'Check', everyMinutes: 1 }, 1_700_000_000_000);
  expect(await watches.cancelPromptWatch(OTHER, first.id)).toBe(false);
  expect((await watches.listPromptWatches(SESSION))).toHaveLength(1);
  expect(await watches.cancelPromptWatch(SESSION, first.id)).toBe(true);
  expect((await watches.listPromptWatches(SESSION))).toHaveLength(0);
  await watches.runDuePromptWatches(1_700_000_100_000, deps);
  expect(queued).toHaveLength(0);
  for (const url of [
    'https://github.com.evil.test/example/repo/actions/runs/123',
    'https://github.com/example/repo/actions/runs/123?token=secret',
    'https://github.com/example/repo/actions/runs/123;echo',
    'http://github.com/example/repo/actions/runs/123',
    'https://github.com/example/repo/actions/runs/not-a-run'
  ]) expect(watches.githubRunTarget(url)).toBeNull();
});

it('completes a local terminal watch only for the exact process incarnation, with no polling prompts', async () => {
  const { watches, deps, queued } = await setup();
  const now = 1_700_100_000_000;
  const first = await watches.createPromptWatch(SESSION, { kind: 'exec_process', prompt: 'Review this test output',
    processId: 1234, incarnation: 77 }, now);
  deps.inspectExecProcess = () => ({ state: 'running' });
  await watches.runDuePromptWatches(now + 30_000, deps);
  expect(queued).toHaveLength(0);
  expect(await watches.completeExecProcessWatches(1234, 78, 1, now + 31_000)).toBe(0);
  expect(await watches.completeExecProcessWatches(1234, 77, 1, now + 31_000)).toBe(1);
  expect(await watches.completeExecProcessWatches(1234, 77, 1, now + 32_000)).toBe(0);
  await watches.runDuePromptWatches(now + 33_000, deps);
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({ scheduled: { scheduleId: first.id, dueAt: now + 31_000, late: false },
    text: expect.stringContaining('exited with code 1') });
  expect(queued[0]!.text).toContain('Review this test output');
  expect((await watches.listPromptWatches(SESSION))[0]).toMatchObject({ active: false, outcome: 'failure', exitCode: 1 });
  await watches.runDuePromptWatches(now + 600_000, deps);
  expect(queued).toHaveLength(1);
});

it('durably accepts one authenticated completion signal, and replays nothing after restart', async () => {
  const { watches, deps, queued } = await setup();
  const now = 1_700_100_000_000;
  const registered = await watches.createPromptWatch(SESSION, { kind: 'signal',
    label: 'independent Python integration', prompt: 'Read the generated report' }, now);
  expect(await watches.completePromptWatch(OTHER, registered.id, 'success', now + 100)).toBe('not_found');
  expect(await watches.completePromptWatch(SESSION, registered.id, 'success', now + 101)).toBe('queued');
  expect(await watches.completePromptWatch(SESSION, registered.id, 'failure', now + 105)).toBe('already_completed');
  vi.resetModules();
  (await import('../src/main/durable.js')).initDurableStore(dir);
  const resumed = await import('../src/main/prompt-watches.js');
  await resumed.runDuePromptWatches(now + 4_000, deps);
  expect(queued).toHaveLength(1);
  expect(queued[0]).toMatchObject({ text: expect.stringContaining('reported success'),
    scheduled: { scheduleId: registered.id, dueAt: now + 101, late: false } });
  await resumed.runDuePromptWatches(now + 20_000, deps);
  expect(queued).toHaveLength(1);
});

it('reports an untracked terminal as unverified rather than falsely claiming success', async () => {
  const { watches, deps, queued } = await setup();
  const now = 1_700_100_000_000;
  await watches.createPromptWatch(SESSION, { kind: 'exec_process', processId: 8800, incarnation: 2,
    prompt: 'Verify whether the local build survived this CoS restart' }, now);
  deps.inspectExecProcess = () => ({ state: 'lost' });
  await watches.runDuePromptWatches(now + 31_000, deps);
  expect(queued).toHaveLength(1);
  expect(queued[0]!.text).toContain('exit unverified');
  expect(queued[0]!.text).not.toContain('exited with code 0');
});
