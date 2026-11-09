import type { PluginRefreshStatus, PluginSurface } from './plugin-refresh.js';

/** Safe per-connector snapshot for the Workspace progress UI; no app IDs, tool data or secrets. */
export interface WorkspacePluginRefreshStep {
  surface: PluginSurface;
  status: PluginRefreshStatus['state'];
  /** A previously current connector still needs this manual round's read-only browser check. */
  observing: boolean;
}
