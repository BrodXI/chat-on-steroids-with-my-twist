import { enrolledPluginSurfaces, pluginRefreshPublications, pluginRefreshStatuses, requestPluginRefreshes } from './plugin-refresh.js';
import type { PluginSurface } from '../shared/plugin-refresh.js';
import type { WorkspacePluginRefreshStep } from '../shared/workspace-plugin-refresh.js';
import { APP_VERSION } from './version.js';

const DISPLAY_ORDER: readonly PluginSurface[] = ['core', 'desktop', 'plugins'];

/**
 * Only installed-in-ChatGPT connectors with current local publications appear in the UI.
 * Local availability alone is not proof that a plugin is installed on the provider side.
 */
export async function workspacePluginRefreshSteps(): Promise<WorkspacePluginRefreshStep[]> {
  const installed = new Set(await enrolledPluginSurfaces());
  const published = new Set(pluginRefreshPublications().map(publication => publication.surface));
  const status = await pluginRefreshStatuses();
  return DISPLAY_ORDER.filter(surface => installed.has(surface) && published.has(surface))
    .map(surface => ({
      surface,
      status: status[surface]?.state ?? 'unknown',
      observing: status[surface]?.observing === true
    }));
}

/**
 * Person-initiated checks of all currently published connectors (including first enrollment).
 * The provider's existing ledger owns click authorization and verification. A separate
 * read-only status query is used for the progress UI and filters to enrolled connectors.
 */
export async function requestWorkspacePluginRefresh(): Promise<number> {
  const surfaces = pluginRefreshPublications().map(publication => publication.surface);
  if (!surfaces.length) return 0;
  await requestPluginRefreshes(APP_VERSION, surfaces);
  return surfaces.length;
}
