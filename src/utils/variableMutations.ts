/**
 * Helpers for reconciling script-induced variable mutations back into
 * a persistent `EnvVariable[]` (workspace globals, collection vars, or
 * environment vars).
 *
 * The request pipeline hands each scope a flat `Record<string, string>`
 * snapshot before running pre/test scripts. After the script returns
 * the store needs to:
 *
 *   1. Detect which keys the script changed or removed (`diffVarMutations`).
 *   2. Apply that diff back to the persistent `EnvVariable[]` while
 *      keeping flag fields (`enabled`, `is_secret`) intact and
 *      appending newly-introduced keys as enabled, non-secret rows
 *      (`applyVarMutations`).
 *
 * All three scope callers (globals, collection, environment) share
 * this single implementation so the logic is tested in one place.
 */

import type { EnvVariable } from "../types";

/** A change set produced by diffing a script-mutated var map against
 *  its pre-script baseline. `changes` covers both updates and newly
 *  introduced keys; `deletions` is the list of keys removed from the
 *  map that the caller should drop from the persistent layer. */
export interface VarMutationDiff {
  changes: Record<string, string>;
  deletions: string[];
}

/** Compare `current` against `baseline` and return the change set.
 *
 *  `ownableKeys` is an optional safety net for layers whose baseline
 *  includes keys merged in from lower scopes (e.g. the environment
 *  layer sees global / collection / folder vars in its baseline). A
 *  script "deletion" of such a key shouldn't try to remove it from
 *  this layer because the key doesn't live here in the first place.
 *  Omit the parameter for layers where the baseline IS the layer's
 *  own vars (globals, collection). */
export function diffVarMutations(
  baseline: Record<string, string>,
  current: Record<string, string>,
  ownableKeys?: Set<string>,
): VarMutationDiff {
  const changes: Record<string, string> = {};
  for (const [k, v] of Object.entries(current)) {
    if (baseline[k] !== v) changes[k] = v;
  }
  const deletions = Object.keys(baseline).filter((k) => {
    if (k in current) return false;
    if (ownableKeys && !ownableKeys.has(k)) return false;
    return true;
  });
  return { changes, deletions };
}

/** Apply a diff to `source`. Returns a new array; does not mutate.
 *
 *   - Existing rows keep their `enabled` / `is_secret` flags.
 *   - Rows in `deletions` are dropped only when they're enabled with a
 *     non-empty key (disabled or empty rows pass through untouched so
 *     the user's draft state in the UI is preserved).
 *   - Keys in `changes` that don't already exist as a row are
 *     appended as `{ enabled: true, is_secret: false }`. */
export function applyVarMutations(
  source: EnvVariable[],
  diff: VarMutationDiff,
): EnvVariable[] {
  const next = source
    .filter((v) => !v.enabled || !v.key || !diff.deletions.includes(v.key))
    .map((v) =>
      v.enabled && v.key && v.key in diff.changes
        ? { ...v, value: diff.changes[v.key] }
        : v,
    );
  for (const k of Object.keys(diff.changes)) {
    if (!source.some((v) => v.key === k)) {
      next.push({
        key: k,
        value: diff.changes[k],
        enabled: true,
        is_secret: false,
      });
    }
  }
  return next;
}

/** Cheap predicate to skip the persistence call when the script didn't
 *  touch anything in this scope. */
export function hasVarMutations(diff: VarMutationDiff): boolean {
  return Object.keys(diff.changes).length > 0 || diff.deletions.length > 0;
}
