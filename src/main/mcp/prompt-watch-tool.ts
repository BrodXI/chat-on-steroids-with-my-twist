import { z } from 'zod';
import { currentCaller } from './call-context.js';
import { fail, failIdentity, guard, ok, type SurfaceRegistrar } from './kernel.js';
import { toolDeclaration } from './tool-declarations.js';
import { conversationAttachment } from '../session/store.js';
import { runningExecProcesses } from '../codex/ownership.js';
import { getConfig } from '../config.js';
import { cancelPromptWatch, completeExecProcessWatches, createPromptWatch, githubRunTarget, inspectGithubRun, listPromptWatches } from '../prompt-watches.js';
import { unifiedExecManager } from '../codex/manager.js';

const createInterval = z.object({ action: z.literal('interval'), everyMinutes: z.number().int().min(1).max(1440),
  prompt: z.string().trim().min(1).max(4000) }).strict();
const createGithub = z.object({ action: z.literal('github_run'), url: z.string().url().max(260),
  pollMinutes: z.number().int().min(1).max(60).default(1),
  prompt: z.string().trim().min(1).max(4000).default('Check the completed test results, identify any failures, and continue the original task.') }).strict();
const createProcess = z.object({ action: z.literal('exec_process'), session_id: z.number().int().positive(),
  prompt: z.string().trim().min(1).max(4000).default('Inspect the finished terminal session results and continue the original task.') }).strict();
const createSignal = z.object({ action: z.literal('signal'), label: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(4000) }).strict();
const list = z.object({ action: z.literal('list') }).strict();
const cancel = z.object({ action: z.literal('cancel'), id: z.string().uuid() }).strict();
const schema = z.discriminatedUnion('action', [createInterval, createGithub, createProcess, createSignal, list, cancel]);

/** Like update_plan, but this model tool creates a durable next turn in the same proven chat. */
export function registerPromptWatchTool(reg: SurfaceRegistrar): void {
  reg.register('prompt_watch', toolDeclaration('prompt_watch', () => ({
    title: 'Watch a test or schedule a follow-up prompt',
    description: 'Like update_plan, but creates a completion-triggered next message in this exact chat. ' +
      'github_run silently checks a GitHub Actions URL (pollMinutes) and prompts once when completed. ' +
      'exec_process watches this chat’s running exec_command session_id and prompts on exit. ' +
      'signal waits for a trusted local integration to POST /v1/watches/{id}/complete through the authenticated Local control API with Allow actions enabled. ' +
      'interval repeats the prompt every everyMinutes; prefer completion watches. list/cancel manage watches. ' +
      'Durable, receipt-safe browser delivery; CoS must be running. Requires user monitoring intent.',
    inputSchema: schema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  })), input => guard('prompt_watch', async () => {
    if (!reg.sessionToolsLive) return reg.featureDisabled('Session recording', 'Settings → Chat');
    const caller = currentCaller();
    if (!caller.sessionId || !caller.conversationId) return failIdentity('A proven ChatGPT session and conversation are required to create a watcher. No watch was changed.');
    if (await conversationAttachment(caller.conversationId, caller.sessionId) !== 'current')
      return failIdentity('This chat has changed or no longer owns its session. No watch was changed.');
    if (input.action === 'list') {
      const rows = await listPromptWatches(caller.sessionId);
      return ok(rows.length ? JSON.stringify(rows.map(row => ({ id: row.id, kind: row.kind, prompt: row.prompt,
        active: row.active, nextCheckAt: row.nextDueAt, ...(row.kind === 'interval'
          ? { everyMinutes: row.everyMinutes } : row.kind === 'github_run' ? { url: row.url, pollMinutes: row.pollMinutes, outcome: row.outcome ?? null,
            lastError: row.lastError ?? null } : row.kind === 'exec_process' ? { session_id: row.processId, outcome: row.outcome ?? null }
            : { label: row.label, outcome: row.outcome ?? null }) }))) : 'No prompt watches in this chat.');
    }
    if (reg.ctx.readOnly) return fail('READ_ONLY: Watching or cancelling automated future prompts requires write permission. No watch was changed.');
    if (input.action === 'cancel') {
      return await cancelPromptWatch(caller.sessionId, input.id)
        ? ok('Watch cancelled. No more checks will be scheduled; an already queued prompt may still be delivered.')
        : fail('No watch with this id belongs to this chat.');
    }
    if (input.action === 'github_run' && !githubRunTarget(input.url)) return fail('Invalid GitHub Actions run URL. Supply https://github.com/owner/repo/actions/runs/12345');
    if (input.action === 'signal' && !(getConfig().controlApi.enabled && getConfig().controlApi.allowActions))
      return fail('Local completion signals require Settings → Local control API → Local control API and Allow actions. Enable both before creating a signal watch. No watch was created.');
    if (input.action === 'github_run') {
      try { await inspectGithubRun(input.url); }
      catch { return fail('GitHub run could not be checked. Install/authenticate GitHub CLI (gh auth login), or use action=interval for periodic prompts. No watch was created.'); }
    }
    let process: ReturnType<typeof runningExecProcesses>[number] | undefined;
    if (input.action === 'exec_process') {
      process = runningExecProcesses(caller.sessionId).find(row => row.processId === input.session_id);
      if (!process) return fail('This chat does not own a running exec_command session with that id. No watch was created.');
    }
    const watch = await createPromptWatch(caller.sessionId, input.action === 'interval'
      ? { kind: 'interval', prompt: input.prompt, everyMinutes: input.everyMinutes }
      : input.action === 'github_run' ? { kind: 'github_run', url: input.url, prompt: input.prompt, pollMinutes: input.pollMinutes }
      : input.action === 'exec_process' ? { kind: 'exec_process', processId: process!.processId, incarnation: process!.incarnation, prompt: input.prompt }
      : { kind: 'signal', label: input.label, prompt: input.prompt });
    if (watch.kind === 'exec_process') {
      const state = unifiedExecManager.inspectProcess(watch.processId, watch.incarnation);
      if (state.state === 'completed') await completeExecProcessWatches(watch.processId, watch.incarnation, state.exitCode);
    }
    return ok(`Prompt watch ${watch.id} created for this chat. ${watch.kind === 'github_run'
      ? `CoS checks ${watch.url} every ${watch.pollMinutes} minute(s) and queues one prompt when GitHub reports completion.`
      : watch.kind === 'interval' ? `CoS queues your prompt every ${watch.everyMinutes} minute(s).`
      : watch.kind === 'exec_process' ? `CoS will prompt when terminal session ${watch.processId} exits.`
      : `A local tool can signal completion at POST /v1/watches/${watch.id}/complete with {"sessionId":"${caller.sessionId}","result":"success"}.` } ` +
      'This uses the existing browser Send safety checks. Leave CoS running for timely updates; use prompt_watch action=cancel to stop it.');
  }));
}
