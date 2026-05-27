/** A single selectable destination inside the Save-to-Collection modal:
 *  either a collection root or a specific folder within a collection. */
export type SaveDestination =
  | { kind: "collection"; collectionId: string }
  | { kind: "folder"; collectionId: string; folderId: string };

/**
 * Compute the initial pre-selected destination for the Save-to-Collection
 * modal. Extracted out of the component so it can be unit-tested without
 * spinning up React.
 *
 * Returns the active tab's current `collectionId` as a pre-selection — but
 * only when that collection still exists. If the tab is bound to a
 * collection that has since been deleted (the typical case when the modal
 * is opened from a failed in-place ⌘S save), this returns `null` so the
 * Save button starts disabled and forces the user to pick a real
 * destination, instead of silently dispatching a save that the backend
 * will reject with a confusing second error.
 */
export function initialSelectedDestination(
  activeCollectionId: string | null | undefined,
  collections: ReadonlyArray<{ id: string }>,
): SaveDestination | null {
  if (!activeCollectionId) return null;
  if (!collections.some((c) => c.id === activeCollectionId)) return null;
  return { kind: "collection", collectionId: activeCollectionId };
}
