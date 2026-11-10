import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

// Exercise the actual native Send selector used by both source Compact and
// destination Resume. A Project form can omit data-chatgpt-composer.
const source = readFileSync(fileURLToPath(new URL('../extension/chatgpt-dom.js', import.meta.url)), 'utf8');
const selector = source.match(/const SEND = '([^']+)';/)?.[1];
if (!selector) throw new Error('Native Send selector not found');

function nativeSend(html: string) {
  const document = new JSDOM(html).window.document;
  const editor = document.querySelector('#prompt-textarea');
  const form = editor?.closest('form');
  if (!form) throw new Error('Missing fixture form');
  const matches = [...form.querySelectorAll(selector!)];
  return matches.length === 1 ? matches[0] : null;
}

describe('Project Compact & Resume native Send', () => {
  it('recognizes an unlabeled submit control in a Project composer without form marker', () => {
    expect(nativeSend('<form><div id="prompt-textarea" contenteditable="true">[[CLF-RESUME:token]] brief</div><button type="submit" id="send"></button></form>')?.id).toBe('send');
  });

  it('recognizes the same control for a source Compact handoff', () => {
    expect(nativeSend('<form><div id="prompt-textarea" contenteditable="true">[[CLF-HANDOFF:token]]</div><button type="submit" id="send"></button></form>')?.id).toBe('send');
  });

  it('does not select a control belonging to another form', () => {
    expect(nativeSend('<form><div id="prompt-textarea"></div></form><form><button type="submit" id="unrelated"></button></form>')).toBeNull();
  });

  it('refuses ambiguous submit controls rather than guessing', () => {
    expect(nativeSend('<form><div id="prompt-textarea"></div><button type="submit"></button><button type="submit"></button></form>')).toBeNull();
  });
});
