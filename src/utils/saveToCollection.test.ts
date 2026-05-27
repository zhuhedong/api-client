import { describe, it, expect } from "vitest";
import { initialSelectedDestination } from "./saveToCollection";

/**
 * Regression tests for the stale-collection bug surfaced by Devin Review
 * on PR #8: when ⌘S opens the SaveToCollectionModal because an in-place
 * save failed (the original collection was deleted out from under the
 * tab), the modal must NOT pre-select that stale collection ID. Doing so
 * would leave the Save button enabled but pointing at a destination the
 * backend can't find, producing a confusing second error on top of the
 * first one.
 */
describe("initialSelectedDestination", () => {
  const collections = [
    { id: "col-a", name: "A" },
    { id: "col-b", name: "B" },
  ];

  it("returns null when activeCollectionId is null or undefined", () => {
    expect(initialSelectedDestination(null, collections)).toBeNull();
    expect(initialSelectedDestination(undefined, collections)).toBeNull();
  });

  it("returns null when activeCollectionId is an empty string", () => {
    expect(initialSelectedDestination("", collections)).toBeNull();
  });

  it("pre-selects the active collection when it still exists", () => {
    expect(initialSelectedDestination("col-a", collections)).toEqual({
      kind: "collection",
      collectionId: "col-a",
    });
  });

  it("returns null when the active collection has been deleted (stale ID)", () => {
    // The tab still remembers a collectionId, but it no longer exists in
    // the live collections list. This is exactly the state the modal is
    // in when opened via the failed-⌘S path — the original collection
    // was deleted out from under the tab.
    expect(initialSelectedDestination("col-deleted", collections)).toBeNull();
  });

  it("returns null when the collections list is empty", () => {
    expect(initialSelectedDestination("col-a", [])).toBeNull();
  });
});
