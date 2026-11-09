import { pluginRefreshPublications, requestPluginRefreshes } from './plugin-refresh.js';
import { APP_VERSION } from './version.js';

/**
 * A person-initiated check of the currently published CoS connectors.
 * The existing ledger owns authorization, tunnel settling, duplicate-click prevention
 * and evidence of actual completion. This function only queues the request.
 */
export async function requestWorkspacePluginRefresh(): Promise<number> {
  const surfaces = pluginRefreshPublications().map(publication => publication.surface);
  if (!surfaces.length) return 0;
  await requestPluginRefreshes(APP_VERSION, surfaces);
  return surfaces.length;
}
