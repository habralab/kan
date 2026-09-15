import { describe, expect, it } from "vitest";

import {
  checklistDestinationIndex,
  visibleChecklistItems,
} from "./checklist-items";

const items = [
  { publicId: "done-a", completed: true },
  { publicId: "open-b", completed: false },
  { publicId: "open-c", completed: false },
  { publicId: "done-d", completed: true },
  { publicId: "open-e", completed: false },
];

describe("checklist items with completed items hidden", () => {
  it("keeps the original order of incomplete items", () => {
    expect(
      visibleChecklistItems(items, true).map((item) => item.publicId),
    ).toEqual(["open-b", "open-c", "open-e"]);
    expect(visibleChecklistItems(items, false)).toEqual(items);
  });

  it("maps visible drop positions back to the full checklist", () => {
    expect(checklistDestinationIndex(items, true, 0)).toBe(1);
    expect(checklistDestinationIndex(items, true, 1)).toBe(2);
    expect(checklistDestinationIndex(items, true, 2)).toBe(4);
    expect(checklistDestinationIndex(items, false, 3)).toBe(3);
    expect(checklistDestinationIndex(items, true, 3)).toBe(-1);
  });

  it("maps moves across completed items in both directions", () => {
    expect(checklistDestinationIndex(items, true, 2)).toBe(4);
    expect(checklistDestinationIndex(items, true, 0)).toBe(1);
  });

  it("handles completed runs and empty visible lists", () => {
    expect(
      checklistDestinationIndex(
        [
          { publicId: "done-a", completed: true },
          { publicId: "done-b", completed: true },
          { publicId: "open-c", completed: false },
        ],
        true,
        0,
      ),
    ).toBe(2);
    expect(
      checklistDestinationIndex(
        [{ publicId: "done-a", completed: true }],
        true,
        0,
      ),
    ).toBe(-1);
    expect(checklistDestinationIndex(items, false, 4)).toBe(4);
  });
});
