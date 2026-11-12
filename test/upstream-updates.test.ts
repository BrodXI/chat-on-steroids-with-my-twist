import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { checkUpstreamRelease, onUpstreamUpdate, resetUpstreamReleaseForTests, upstreamUpdateStatus } from '../src/main/upstream-updates.js';

beforeEach(() => resetUpstreamReleaseForTests());
afterEach(() => resetUpstreamReleaseForTests());

it('reports only a newer official release, never a fork installer candidate', async () => {
  const changed = vi.fn();
  onUpstreamUpdate(changed);
  const urls: string[] = [];
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    urls.push(String(input));
    return new Response(JSON.stringify({ tag_name: 'v99.0.0' }), { status: 200 });
  }) as unknown as typeof fetch;
  await checkUpstreamRelease(fetcher);
  expect(upstreamUpdateStatus().latest).toBe('99.0.0');
  expect(upstreamUpdateStatus().checkedAt).toBeTypeOf('number');
  expect(changed).toHaveBeenCalledOnce();
  expect(urls).toEqual(['https://api.github.com/repos/totec448-spec/chat-on-steroids/releases/latest']);
  await checkUpstreamRelease(async () => new Response(JSON.stringify({ tag_name: 'v2.1.52' })));
  expect(upstreamUpdateStatus().latest).toBeNull();
});

it('a failing official check cannot clear a previous notice or affect fork update state', async () => {
  await checkUpstreamRelease(async () => new Response(JSON.stringify({ tag_name: 'v99.0.0' })));
  const before = upstreamUpdateStatus();
  await checkUpstreamRelease(async () => { throw new Error('offline'); });
  expect(upstreamUpdateStatus()).toEqual(before);
});
