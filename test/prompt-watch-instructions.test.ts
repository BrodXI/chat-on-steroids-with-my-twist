import { afterEach, expect, it } from 'vitest';
import { getConfig } from '../src/main/config.js';
import { serverInstructions } from '../src/main/mcp/instructions.js';
import { surfaceDefinition } from '../src/main/mcp/surfaces.js';
import { DEFAULT_CAPABILITIES } from '../src/shared/types.js';
import { DEFAULT_GOAL_LOOP_SYSTEM_PROMPT, DEFAULT_GOAL_OBJECTIVE_SYSTEM_PROMPT } from '../src/shared/goal.js';

const settings = getConfig().goal;
const saved = { enabled: settings.enabled, mode: settings.mode };
afterEach(() => {
  settings.enabled = saved.enabled;
  settings.mode = saved.mode;
});

const context = {
  roots: [],
  caps: { ...DEFAULT_CAPABILITIES },
  readOnly: false,
  sessionTools: true,
  agentTools: false
};

it.each([
  ['normal', false, 'goal'],
  ['Goal', true, 'goal'],
  ['Loop', true, 'loop']
] as const)('offers the same Core completion watcher to %s executor turns', (_label, enabled, mode) => {
  settings.enabled = enabled;
  settings.mode = mode;
  const core = serverInstructions(context, 'core', 'darwin', '');
  expect(surfaceDefinition('core').tools).toEqual(expect.arrayContaining(['update_plan', 'prompt_watch']));
  expect(core).toContain('# Task plan');
  expect(core).toContain('# Completion watches');
  expect(core).toContain('prompt_watch is callable from ordinary chats and Goal/Loop executor turns');
  expect(core).toContain('github_run');
  expect(core).toContain('exec_process');
  expect(core).toContain('without repeatedly prompting ChatGPT');
});

it('does not offer watcher instructions when session tools are unavailable', () => {
  const core = serverInstructions({ ...context, sessionTools: false }, 'core', 'darwin', '');
  expect(core).not.toContain('# Completion watches');
  expect(core).not.toContain('prompt_watch');
});

it('keeps Goal and Loop decision helpers prompt-only: the executor calls the watcher', () => {
  for (const prompt of [DEFAULT_GOAL_OBJECTIVE_SYSTEM_PROMPT, DEFAULT_GOAL_LOOP_SYSTEM_PROMPT]) {
    expect(prompt).toContain('Do not execute the task, call tools');
  }
});
