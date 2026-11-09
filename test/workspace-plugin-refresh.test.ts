import { beforeEach, expect, it, vi } from 'vitest';
import { APP_VERSION } from '../src/main/version.js';

const refresh = vi.hoisted(() => ({
  publications: vi.fn(),
  request: vi.fn()
}));
vi.mock('../src/main/plugin-refresh.js', () => ({
  pluginRefreshPublications: refresh.publications,
  requestPluginRefreshes: refresh.request
}));

import { requestWorkspacePluginRefresh } from '../src/main/workspace-plugin-refresh.js';

beforeEach(() => {
  vi.resetAllMocks();
  refresh.publications.mockReturnValue([]);
  refresh.request.mockResolvedValue(undefined);
});

it('does not create plugin-refresh debt when no connector is published', async () => {
  expect(await requestWorkspacePluginRefresh()).toBe(0);
  expect(refresh.request).not.toHaveBeenCalled();
});

it('requests the current version and only the currently published connectors', async () => {
  refresh.publications.mockReturnValue([
    { surface: 'core' },
    { surface: 'plugins' }
  ]);
  expect(await requestWorkspacePluginRefresh()).toBe(2);
  expect(refresh.request).toHaveBeenCalledExactlyOnceWith(APP_VERSION, ['core', 'plugins']);
});

it('does not report an accepted request when the durable refresh ledger cannot be written', async () => {
  refresh.publications.mockReturnValue([{ surface: 'desktop' }]);
  refresh.request.mockRejectedValueOnce(new Error('Could not read plugin-refresh state'));
  await expect(requestWorkspacePluginRefresh()).rejects.toThrow('Could not read plugin-refresh state');
});
