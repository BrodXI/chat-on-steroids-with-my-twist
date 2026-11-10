import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');
const begin = source.indexOf('  function answerTurnFor(');
const end = source.indexOf('  // Only the bridge\'s terminal transaction dispositions', begin);
const marker = source.indexOf('  const unescapeMarkdown =');
const markerEnd = source.indexOf('  /** Receipt, transcript', marker);
const declarations = source.split('\n').filter(line => /^\s*const CONTINUATION_MARKER(?:_ESCAPED)? =/.test(line));
if (begin < 0 || end < 0 || marker < 0 || markerEnd < 0 || declarations.length !== 2) throw new Error('Handoff reader not found');
const { markedContinuationTurns } = vm.runInNewContext(`${declarations.join('\n')}\n${source.slice(marker, markerEnd)}\n${source.slice(begin, end)}\n({ markedContinuationTurns })`) as {
  markedContinuationTurns: (turns: any[], job?: any) => Array<[string, any]>;
};

const token = 'abc0123456789_xyz';
const user = (id: string, rawText = `[[CLF-HANDOFF:${token}]]\n\nWrite the brief`) =>
  ({ role: 'user', stable: true, rawMessageId: id, rawText });
const assistant = (id: string, rawText: string) => ({ role: 'assistant', stable: true, rawMessageId: id, rawText });
const turn = (index: number, messages: any[], endMessageId: string | null = null, calls: any[] = []) =>
  ({ index, messages, endMessageId, calls });
const pending = (id: string, state = 'sent') => ({ stage: 'handoff-pending', token, sourceSend: { state, messageId: id } });

describe('Compact & Resume recovers the exact completed source response', () => {
  it('finds the final brief after an assistant preamble and answered tool descriptor', () => {
    const final = turn(3, [assistant('final', 'The complete handoff')], 'final');
    const turns = [
      turn(0, [user('question')]),
      turn(1, [assistant('intro', 'Preparing the handoff')]),
      turn(2, [], null, [{ answered: true }]),
      final
    ];
    const entry = markedContinuationTurns(turns)[0]?.[1];
    expect(entry?.answer).toBe(final);
    expect(entry?.answerRun).toEqual(turns.slice(1));
  });

  it('includes prose already grouped with the source prompt', () => {
    const first = turn(0, [user('question'), assistant('intro', 'Preparing')]);
    const final = turn(1, [assistant('final', 'The complete handoff')], 'final');
    expect(markedContinuationTurns([first, final])[0]?.[1].answerRun).toEqual([first, final]);
  });

  it('does not borrow an answer after the next user message', () => {
    const preamble = turn(1, [assistant('intro', 'Preparing')]);
    const turns = [turn(0, [user('question')]), preamble, turn(2, [user('later', 'Unrelated')]),
      turn(3, [assistant('wrong', 'Unrelated final')], 'wrong')];
    expect(markedContinuationTurns(turns)[0]?.[1].answer).toBe(preamble);
    expect(markedContinuationTurns(turns)[0]?.[1].answer.endMessageId).toBeNull();
  });

  it('does not bridge a gap in the native transcript', () => {
    const turns = [turn(0, [user('question')]), turn(3, [assistant('wrong', 'Unproven answer')], 'wrong')];
    expect(markedContinuationTurns(turns)[0]?.[1].answer).toBeNull();
  });

  it('never treats an earlier terminal as final while a newer descriptor is unfinished', () => {
    const unfinished = turn(2, [assistant('partial', 'Still writing')], null, [{ answered: false }]);
    const turns = [turn(0, [user('question')]), turn(1, [assistant('early', 'Earlier text')], 'early'), unfinished];
    expect(markedContinuationTurns(turns)[0]?.[1].answer).toBe(unfinished);
  });

  it('recovers a missing marker only from the durable sent source message id', () => {
    const final = turn(1, [assistant('final', 'The complete handoff')], 'final');
    const turns = [turn(0, [user('question', '')]), final];
    expect(markedContinuationTurns(turns, pending('question'))[0]?.[1]).toMatchObject({
      kind: 'HANDOFF', token, messageId: 'question', answer: final
    });
    expect(markedContinuationTurns(turns, pending('different'))).toEqual([]);
    expect(markedContinuationTurns(turns, pending('question', 'dispatched-unresolved'))).toEqual([]);
  });

  it('does not overwrite a conflicting native marker or accept an unstable message', () => {
    const other = 'different012345678';
    const turns = [turn(0, [user('question', `[[CLF-HANDOFF:${other}]]\nWrite`)])];
    expect(markedContinuationTurns(turns, pending('question'))[0]?.[1].token).toBe(other);
    expect(markedContinuationTurns([turn(0, [{ ...user('question', ''), stable: false }])], pending('question'))).toEqual([]);
  });

  it('leaves destination RESUME answer ownership unchanged', () => {
    const first = turn(1, [assistant('intro', 'First response')]);
    const turns = [turn(0, [user('resume', `[[CLF-RESUME:${token}]]\nBrief`)]), first,
      turn(2, [assistant('later', 'Later prose')], 'later')];
    expect(markedContinuationTurns(turns)[0]?.[1].answer).toBe(first);
  });
});
