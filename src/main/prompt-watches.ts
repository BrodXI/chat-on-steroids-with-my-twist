/**
 * Model-created interval prompts and GitHub Actions completion watches.
 *
 * All automatic messages use the existing scheduled browser outbox, not a second Send
 * implementation. Pending occurrences have deterministic IDs and are saved before enqueue,
 * so a crash or an ambiguous enqueue result never invents a second user message.
 * Watching runs only while CoS is running; the next tick catches up after restart.
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { readDurable, writeDurableNow } from './durable.js';
import { MAX_CHATGPT_MESSAGE_CHARS } from '../shared/user-prompt.js';

const execFileAsync = promisify(execFile);
const STORE = 'prompt-watches';
const MAX_WATCHES = 100;
const MAX_PER_CHAT = 12;
const MIN_MINUTES = 1;
const MAX_MINUTES = 24 * 60;
const minute = 60_000;
const time = z.number().int().nonnegative();
const identifier = z.string().uuid();
const common = {
  id: identifier, sessionId: z.string().min(8).max(64), createdAt: time,
  active: z.boolean(), prompt: z.string().trim().min(1).max(4000),
  lastInputId: identifier.optional(), pendingDueAt: time.optional()
};
const completionOutcome = z.enum(['success', 'failure', 'cancelled', 'unknown']);
const intervalSchema = z.object({ ...common,
  kind: z.literal('interval'), everyMinutes: z.number().int().min(MIN_MINUTES).max(MAX_MINUTES),
  nextDueAt: time
}).strict();
const githubSchema = z.object({ ...common,
  kind: z.literal('github_run'), url: z.string().url().max(260), repo: z.string().max(130),
  runId: z.string().regex(/^[1-9]\d{0,19}$/), pollMinutes: z.number().int().min(MIN_MINUTES).max(60),
  nextDueAt: time, outcome: z.enum(['success', 'failure', 'cancelled', 'timed_out', 'action_required', 'neutral', 'skipped', 'stale', 'other']).optional(),
  lastError: z.enum(['unavailable']).optional()
}).strict();
const localProcessSchema = z.object({ ...common,
  kind: z.literal('exec_process'), processId: z.number().int().positive(), incarnation: z.number().int().positive(),
  nextDueAt: time, outcome: completionOutcome.optional(), exitCode: z.number().int().nullable().optional()
}).strict();
const signalSchema = z.object({ ...common,
  kind: z.literal('signal'), label: z.string().trim().min(1).max(120), nextDueAt: time,
  outcome: completionOutcome.optional()
}).strict();
const watchSchema = z.discriminatedUnion('kind', [intervalSchema, githubSchema, localProcessSchema, signalSchema]);
const storeSchema = z.object({ version: z.literal(1), watches: z.array(watchSchema).max(MAX_WATCHES) }).strict();
export type PromptWatch = z.infer<typeof watchSchema>;

export interface WatchInputSnapshot {
  id: string;
  state: 'queued' | 'browser' | 'tool' | 'sent' | 'cancelled' | 'failed' | 'decision';
  deliveryProof?: 'sent' | 'not_sent' | 'unconfirmed' | 'pending';
  deliveredAt?: number;
  sendAuthorizedAt?: number;
}

export interface WatchDeps {
  session(id: string): Promise<{ id: string; conversationId: string | null; activeTurnId: string | null } | null>;
  enqueue(input: { id: string; sessionId: string; text: string; mode: 'auto' | 'after-turn'; dueAt: number;
    model: null; reasoningEffort: null; scheduled: { scheduleId: string; dueAt: number; late: boolean } },
    options?: { notify?: boolean }): Promise<unknown>;
  inputs(): Promise<WatchInputSnapshot[]>;
  inspectGithub(url: string): Promise<{ status: 'queued' | 'in_progress' | 'completed'; conclusion: string | null }>;
  inspectExecProcess?(processId: number, incarnation: number):
    { state: 'running' } | { state: 'completed'; exitCode: number | null } | { state: 'lost' };
  log(line: string): void;
  changed?(): void;
}
let wake: (() => void) | null = null;
/** Event producers wake the runner immediately; its regular timer remains restart protection. */
export function setPromptWatchWake(notify: (() => void) | null): void { wake = notify; }
function wakeRunner(): void { try { wake?.(); } catch { /* persisted record remains available to the timer */ } }

let chain: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task);
  chain = next.catch(() => undefined);
  return next;
}

async function load(): Promise<PromptWatch[]> {
  const stored = await readDurable(STORE, { strict: true });
  if (stored === null) return [];
  const parsed = storeSchema.safeParse(stored);
  if (!parsed.success) throw new Error('Prompt watches state is invalid or belongs to a newer CoS version. No watches were changed.');
  return parsed.data.watches;
}
const save = (watches: PromptWatch[]) => writeDurableNow(STORE, { version: 1, watches });

/** Never accept a URL with a token, redirect host, arbitrary API path or shell metacharacters. */
export function githubRunTarget(raw: string): { url: string; repo: string; runId: string } | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password ||
        url.port || url.search || url.hash) return null;
    const found = /^\/([A-Za-z0-9_.-]{1,60})\/([A-Za-z0-9_.-]{1,70})\/actions\/runs\/([1-9]\d{0,19})\/?$/.exec(url.pathname);
    if (!found || found[1] === '.' || found[2] === '.') return null;
    return { url: `https://github.com/${found[1]}/${found[2]}/actions/runs/${found[3]}`,
      repo: `${found[1]}/${found[2]}`, runId: found[3]! };
  } catch { return null; }
}

/** Uses the person's existing gh authentication; it never stores or logs a GitHub token. */
export async function inspectGithubRun(raw: string): Promise<{ status: 'queued' | 'in_progress' | 'completed'; conclusion: string | null }> {
  const target = githubRunTarget(raw);
  if (!target) throw new Error('Invalid GitHub Actions run URL');
  const { stdout } = await execFileAsync('gh', ['run', 'view', target.runId, '--repo', target.repo,
    '--json', 'status,conclusion'], { timeout: 15_000, maxBuffer: 16_384, windowsHide: true });
  const data = JSON.parse(stdout) as { status?: unknown; conclusion?: unknown };
  if (!['queued', 'in_progress', 'completed', 'waiting', 'pending', 'requested'].includes(String(data.status)))
    throw new Error('GitHub run status unavailable');
  return { status: data.status === 'completed' ? 'completed' : data.status === 'in_progress' ? 'in_progress' : 'queued',
    conclusion: typeof data.conclusion === 'string' ? data.conclusion : null };
}

function inputId(watch: PromptWatch, dueAt: number): string {
  const hash = createHash('sha256').update(`prompt-watch:${watch.id}:${dueAt}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${((parseInt(hash[16]!, 16) & 3) | 8).toString(16)}${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
function blocking(input: WatchInputSnapshot | undefined): boolean {
  if (!input) return false;
  return ['queued', 'browser', 'tool'].includes(input.state) || input.deliveryProof === 'unconfirmed' ||
    (input.deliveryProof === 'pending' && !['queued', 'browser', 'tool'].includes(input.state)) ||
    (input.sendAuthorizedAt !== undefined && input.deliveredAt === undefined && input.deliveryProof !== 'not_sent');
}

export type PromptWatchSpec = { kind: 'interval'; prompt: string; everyMinutes: number } |
  { kind: 'github_run'; prompt: string; url: string; pollMinutes: number } |
  { kind: 'exec_process'; prompt: string; processId: number; incarnation: number } |
  { kind: 'signal'; prompt: string; label: string };

export function createPromptWatch(sessionId: string, spec: PromptWatchSpec, now = Date.now()): Promise<PromptWatch> {
  return serial(async () => {
    let watches = await load();
    const basic = { id: randomUUID(), sessionId, createdAt: now, active: true, prompt: spec.prompt.trim() };
    const target = spec.kind === 'github_run' ? githubRunTarget(spec.url) : null;
    if (spec.kind === 'github_run' && !target) throw new Error('Give a GitHub Actions run URL such as https://github.com/owner/repo/actions/runs/12345');
    const input = spec.kind === 'interval' ? { ...basic, kind: 'interval' as const,
      everyMinutes: spec.everyMinutes, nextDueAt: now + spec.everyMinutes * minute } :
      spec.kind === 'github_run' ? { ...basic, kind: 'github_run' as const, ...target!, pollMinutes: spec.pollMinutes, nextDueAt: now } :
      spec.kind === 'exec_process' ? { ...basic, kind: 'exec_process' as const,
        processId: spec.processId, incarnation: spec.incarnation, nextDueAt: now } :
        { ...basic, kind: 'signal' as const, label: spec.label, nextDueAt: now };
    const watch = watchSchema.parse(input);
    const duplicate = watches.find(row => row.active && row.sessionId === sessionId && row.kind === watch.kind &&
      row.prompt === watch.prompt && (
        row.kind === 'interval' && watch.kind === 'interval' ? row.everyMinutes === watch.everyMinutes :
        row.kind === 'github_run' && watch.kind === 'github_run' ? row.url === watch.url :
        row.kind === 'exec_process' && watch.kind === 'exec_process' ? row.processId === watch.processId && row.incarnation === watch.incarnation :
        row.kind === 'signal' && watch.kind === 'signal' && row.label === watch.label));
    if (duplicate) return duplicate;
    // Completed one-shot watches are historical records, not permanent capacity claims.
    // Keep the most recent results while guaranteeing old history cannot block new work.
    if (watches.length >= MAX_WATCHES) {
      const retired = watches.filter(row => !row.active)
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      const remove = new Set(retired.slice(0, watches.length - MAX_WATCHES + 1).map(row => row.id));
      watches = watches.filter(row => !remove.has(row.id));
    }
    if (watches.length >= MAX_WATCHES) throw new Error('Too many prompt watches. Cancel one first.');
    if (watches.filter(row => row.sessionId === sessionId && row.active).length >= MAX_PER_CHAT)
      throw new Error('This chat already has too many active prompt watches.');
    await save([...watches, watch]);
    return watch;
  });
}

/** Authenticated local callbacks can mark a named event complete, without sending into a chat. */
export function completePromptWatch(sessionId: string, id: string, result: z.infer<typeof completionOutcome>,
  now = Date.now()): Promise<'queued' | 'already_completed' | 'not_found'> {
  return serial(async () => {
    const rows = await load();
    const row = rows.find(item => item.id === id && item.sessionId === sessionId && item.kind === 'signal');
    if (!row || row.kind !== 'signal') return 'not_found';
    if (!row.active || row.pendingDueAt !== undefined) return 'already_completed';
    await save(rows.map(item => item === row ? { ...row, pendingDueAt: now, outcome: result } : item));
    wakeRunner();
    return 'queued';
  });
}

/** A process exit is a local event. Verify the exact incarnation so reused IDs cannot complete old watches. */
export function completeExecProcessWatches(processId: number, incarnation: number, exitCode: number | null,
  now = Date.now()): Promise<number> {
  return serial(async () => {
    const rows = await load();
    const matching = rows.filter(item => item.kind === 'exec_process' && item.active &&
      item.pendingDueAt === undefined && item.processId === processId && item.incarnation === incarnation);
    if (!matching.length) return 0;
    const ids = new Set(matching.map(item => item.id));
    await save(rows.map(item => item.kind === 'exec_process' && ids.has(item.id)
      ? { ...item, pendingDueAt: now,
          outcome: exitCode === 0 ? 'success' as const : 'failure' as const, exitCode }
      : item));
    wakeRunner();
    return matching.length;
  });
}

export function listPromptWatches(sessionId: string): Promise<PromptWatch[]> {
  return serial(async () => (await load()).filter(row => row.sessionId === sessionId));
}

export function cancelPromptWatch(sessionId: string, id: string): Promise<boolean> {
  return serial(async () => {
    const rows = await load();
    const found = rows.find(row => row.id === id && row.sessionId === sessionId);
    if (!found) return false;
    await save(rows.filter(row => row !== found));
    return true;
  });
}

const outcomeLabel = (value: string | null): NonNullable<Extract<PromptWatch, {kind:'github_run'}>['outcome']> =>
  (['success','failure','cancelled','timed_out','action_required','neutral','skipped','stale'].includes(value ?? '')
    ? value : 'other') as NonNullable<Extract<PromptWatch, {kind:'github_run'}>['outcome']>;

/** One serial, crash-replayable pickup pass; no external call can write directly to ChatGPT. */
export function runDuePromptWatches(now: number, deps: WatchDeps): Promise<void> {
  return serial(async () => {
    let rows = await load();
    let inputs: WatchInputSnapshot[];
    try { inputs = await deps.inputs(); } catch { deps.log('prompt watch: outbox unavailable; retrying'); return; }
    for (const original of [...rows]) {
      let row = rows.find(watch => watch.id === original.id);
      if (!row || !row.active) continue;
      const replace = async (next: PromptWatch | null) => {
        rows = next ? rows.map(item => item.id === original.id ? next : item) : rows.filter(item => item.id !== original.id);
        await save(rows);
        try { deps.changed?.(); } catch { /* no mutation rollback after durable write */ }
      };
      let session: Awaited<ReturnType<WatchDeps['session']>>;
      try { session = await deps.session(row.sessionId); } catch { continue; }
      if (!session) { await replace(null); continue; }
      if (!session.conversationId) continue;
      if (row.lastInputId && blocking(inputs.find(input => input.id === row!.lastInputId))) continue;
      if (row.kind === 'exec_process' && row.pendingDueAt === undefined && deps.inspectExecProcess) {
        const state = deps.inspectExecProcess(row.processId, row.incarnation);
        if (state.state === 'running') continue;
        row = { ...row, pendingDueAt: now,
          outcome: state.state === 'completed' ? (state.exitCode === 0 ? 'success' : 'failure') : 'unknown',
          exitCode: state.state === 'completed' ? state.exitCode : null };
        await replace(row);
      }
      if (row.kind === 'signal' && row.pendingDueAt === undefined) continue;
      if (row.kind === 'interval' && row.nextDueAt > now && row.pendingDueAt === undefined) continue;
      if (row.kind === 'github_run' && row.nextDueAt > now && row.pendingDueAt === undefined) continue;
      if (row.kind === 'github_run' && row.pendingDueAt === undefined) {
        try {
          const result = await deps.inspectGithub(row.url);
          if (result.status !== 'completed') {
            await replace({ ...row, nextDueAt: now + row.pollMinutes * minute, lastError: undefined });
            continue;
          }
          row = { ...row, pendingDueAt: now, outcome: outcomeLabel(result.conclusion), lastError: undefined };
          // The completion notification must survive a crash *before* the outbox write.
          await replace(row);
        } catch {
          await replace({ ...row, lastError: 'unavailable', nextDueAt: now + row.pollMinutes * minute });
          deps.log('prompt watch: GitHub status unavailable; retrying later');
          continue;
        }
      }
      if (row.kind === 'interval' && row.pendingDueAt === undefined) {
        row = { ...row, pendingDueAt: row.nextDueAt };
        await replace(row);
      }
      const dueAt = row.pendingDueAt!;
      const id = inputId(row, dueAt);
      const known = inputs.find(input => input.id === id);
      if (!known) {
        const text = row.kind === 'interval' ? row.prompt : row.kind === 'github_run' ?
          `GitHub Actions run ${row.url} finished with conclusion: ${row.outcome ?? 'other'}.\n\n${row.prompt}` :
          row.kind === 'exec_process' ?
            `CoS terminal session ${row.processId} ${row.outcome === 'unknown' ? 'is no longer tracked (exit unverified)' : `exited with code ${row.exitCode ?? 'unknown'}`}.\n\n${row.prompt}` :
            `Monitored task "${row.label}" reported ${row.outcome ?? 'unknown'}.\n\n${row.prompt}`;
        if (text.length > MAX_CHATGPT_MESSAGE_CHARS) continue;
        try {
          await deps.enqueue({ id, sessionId: row.sessionId, text, mode: session.activeTurnId ? 'after-turn' : 'auto',
            dueAt, model: null, reasoningEffort: null, scheduled: { scheduleId: row.id, dueAt, late: now - dueAt > 120_000 } });
        } catch {
          // An unknown enqueue result may already be persisted. Keep this exact ID and
          // dueAt until the next run can consult the durable outbox again.
          deps.log('prompt watch: enqueue uncertain; retrying identical occurrence');
          continue;
        }
        inputs.push({ id, state: 'queued' });
      }
      if (row.kind !== 'interval') {
        await replace({ ...row, active: false, lastInputId: id, pendingDueAt: undefined });
        deps.log('prompt watch: completion prompt queued');
      } else {
        await replace({ ...row, lastInputId: id, pendingDueAt: undefined,
          nextDueAt: now + row.everyMinutes * minute });
        deps.log('prompt watch: interval prompt queued');
      }
    }
  });
}
