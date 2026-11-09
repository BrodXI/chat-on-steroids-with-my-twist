import { beforeEach, expect, it, vi } from 'vitest';
import { APP_VERSION } from '../src/main/version.js';

const refresh = vi.hoisted(() => ({
  publications: vi.fn(), request: vi.fn(), enrolled: vi.fn(), statuses: vi.fn()
}));
vi.mock('../src/main/plugin-refresh.js', () => ({
  pluginRefreshPublications: refresh.publications,
  requestPluginRefreshes: refresh.request,
  enrolledPluginSurfaces: refresh.enrolled,
  pluginRefreshStatuses: refresh.statuses
}));

import { requestWorkspacePluginRefresh, workspacePluginRefreshSteps } from '../src/main/workspace-plugin-refresh.js';

beforeEach(() => {
  vi.resetAllMocks();
  refresh.publications.mockReturnValue([]);
  refresh.request.mockResolvedValue(undefined);
  refresh.enrolled.mockResolvedValue([]);
  refresh.statuses.mockResolvedValue({});
});

it('does not create plugin-refresh debt when no connector is published', async () => {
  expect(await requestWorkspacePluginRefresh()).toBe(0);
  expect(refresh.request).not.toHaveBeenCalled();
});

it('requests the current version and all published connectors, including newly installed ones still enrolling', async () => {
  refresh.publications.mockReturnValue([{ surface: 'core' }, { surface: 'plugins' }]);
  expect(await requestWorkspacePluginRefresh()).toBe(2);
  expect(refresh.request).toHaveBeenCalledExactlyOnceWith(APP_VERSION, ['core', 'plugins']);
});

it('does not report an accepted request when the durable refresh ledger cannot be written', async () => {
  refresh.publications.mockReturnValue([{ surface: 'desktop' }]);
  refresh.request.mockRejectedValueOnce(new Error('Could not read plugin-refresh state'));
  await expect(requestWorkspacePluginRefresh()).rejects.toThrow('Could not read plugin-refresh state');
});

it('only lists ChatGPT-enrolled and currently published connectors, in Core/Desktop/Plugins order', async () => {
  refresh.publications.mockReturnValue([{ surface: 'plugins' }, { surface: 'core' }]);
  refresh.enrolled.mockResolvedValue(['desktop', 'plugins', 'core']);
  refresh.statuses.mockResolvedValue({
    core: { state: 'current', observing: true },
    desktop: { state: 'current' },
    plugins: { state: 'pending' }
  });
  expect(await workspacePluginRefreshSteps()).toEqual([
    { surface: 'core', status: 'current', observing: true },
    { surface: 'plugins', status: 'pending', observing: false }
  ]);
});

it('never displays locally published connectors that have not been enrolled in ChatGPT', async () => {
  refresh.publications.mockReturnValue([{ surface: 'core' }, { surface: 'desktop' }, { surface: 'plugins' }]);
  refresh.enrolled.mockResolvedValue(['core']);
  refresh.statuses.mockResolvedValue({ core: { state: 'refreshing' } });
  expect(await workspacePluginRefreshSteps()).toEqual([{ surface: 'core', status: 'refreshing', observing: false }]);
});
