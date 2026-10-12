import { describe, expect, it } from "vitest";

import { filterMemberOptions } from "./member-search";

const members = [
  { key: "1", value: "Anna Linskaya", selected: true },
  { key: "2", value: "Борис Иванов", selected: false },
  { key: "3", value: "person@example.test", selected: false },
];

describe("filterMemberOptions", () => {
  it("keeps all options and their selection state for an empty query", () => {
    expect(filterMemberOptions(members, "  ")).toBe(members);
  });

  it("matches visible names and email fallbacks without case sensitivity", () => {
    expect(filterMemberOptions(members, "  LINSK ")).toEqual([members[0]]);
    expect(filterMemberOptions(members, "иван")).toEqual([members[1]]);
    expect(filterMemberOptions(members, "EXAMPLE.TEST")).toEqual([members[2]]);
  });

  it("does not alter selected options when the query has no matches", () => {
    expect(filterMemberOptions(members, "missing")).toEqual([]);
    expect(members[0]?.selected).toBe(true);
  });
});
