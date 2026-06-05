import type { Collection, CollectionFolder, EnvVariable, Environment, RequestItem, Workspace } from "../types";

/**
 * Variable hierarchy / precedence (highest to lowest):
 *
 *   1. Transient (per-execution overrides from pre/post scripts)
 *   2. Environment (active environment's vars)
 *   3. Folder (innermost folder containing the request, walking outward)
 *   4. Collection (request's owning collection)
 *   5. Global (workspace.variables)
 *
 * Everything below the transient layer comes from on-disk state. This module
 * is responsible only for the bottom four layers. Transient overlay happens
 * in `requestPipeline.ts` after pre-scripts run, by mutating the returned
 * record before `substituteAll` consumes it.
 */

function applyVars(into: Record<string, string>, vars: EnvVariable[] | undefined) {
  if (!vars) return;
  for (const v of vars) {
    if (v.enabled && v.key) into[v.key] = v.value;
  }
}

/** Depth-first search to find the chain of folders leading to a request. */
export function findFolderChain(
  folders: CollectionFolder[],
  requestId: string,
  trail: CollectionFolder[],
): CollectionFolder[] | null {
  for (const f of folders) {
    if (f.requests.some((r) => r.id === requestId)) {
      return [...trail, f];
    }
    const deeper = findFolderChain(f.folders, requestId, [...trail, f]);
    if (deeper) return deeper;
  }
  return null;
}

interface BuildContext {
  workspace: Workspace | null;
  collections: Collection[];
  environments: Environment[];
  /** The request whose variables we're resolving (used to find owning collection/folder). */
  request: RequestItem;
}

/**
 * Build the flat variable lookup map used by `substituteAll`. Higher-priority
 * scopes overwrite lower-priority ones via simple Object.assign-style overlay.
 *
 * Folder precedence is "innermost wins" — a variable defined on a leaf folder
 * shadows the same name on its parent. We do this by applying folder vars in
 * outer-to-inner order so the inner overwrite happens last.
 */
export function buildScopedVars(ctx: BuildContext): Record<string, string> {
  const out: Record<string, string> = {};

  // (5) Global — lowest priority
  applyVars(out, ctx.workspace?.variables);

  // (4) Collection
  const collection = ctx.request.collectionId
    ? ctx.collections.find((c) => c.id === ctx.request.collectionId)
    : undefined;
  if (collection) {
    applyVars(out, collection.variables);

    // (3) Folders — walk outer→inner so inner-most overrides win.
    const chain = findFolderChain(collection.folders, ctx.request.id, []);
    if (chain) {
      for (const folder of chain) {
        applyVars(out, folder.variables);
      }
    }
  }

  // (2) Environment — highest priority before transient overlay
  const activeEnvId = ctx.workspace?.active_environment_id;
  const activeEnv = activeEnvId
    ? ctx.environments.find((e) => e.id === activeEnvId)
    : undefined;
  if (activeEnv) {
    applyVars(out, activeEnv.variables);
  }

  return out;
}

/** Which scope layer a resolved variable's winning value came from. */
export type VarSource = "global" | "collection" | "folder" | "environment";

export interface ResolvedVar {
  key: string;
  /** The value from the highest-priority layer that defined this key. */
  value: string;
  source: VarSource;
  /** Human-readable origin: collection / folder / environment name. Omitted
   *  for the global (workspace) scope. */
  origin?: string;
}

/**
 * Like {@link buildScopedVars}, but records *where* each winning value came
 * from so the UI can show the user why `{{token}}` resolves the way it does.
 * Applies the same precedence (global < collection < folder(outer→inner) <
 * environment); the last writer for a key wins, mirroring the flat map.
 *
 * Does not include transient (script-time) overrides — those only exist after
 * pre-scripts run inside the pipeline.
 */
export function buildScopedVarsWithSource(ctx: BuildContext): ResolvedVar[] {
  const map = new Map<string, ResolvedVar>();
  const apply = (
    vars: EnvVariable[] | undefined,
    source: VarSource,
    origin?: string,
  ) => {
    if (!vars) return;
    for (const v of vars) {
      if (v.enabled && v.key) {
        map.set(v.key, { key: v.key, value: v.value, source, origin });
      }
    }
  };

  apply(ctx.workspace?.variables, "global");

  const collection = ctx.request.collectionId
    ? ctx.collections.find((c) => c.id === ctx.request.collectionId)
    : undefined;
  if (collection) {
    apply(collection.variables, "collection", collection.name);
    const chain = findFolderChain(collection.folders, ctx.request.id, []);
    if (chain) {
      for (const folder of chain) apply(folder.variables, "folder", folder.name);
    }
  }

  const activeEnvId = ctx.workspace?.active_environment_id;
  const activeEnv = activeEnvId
    ? ctx.environments.find((e) => e.id === activeEnvId)
    : undefined;
  if (activeEnv) apply(activeEnv.variables, "environment", activeEnv.name);

  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
}
