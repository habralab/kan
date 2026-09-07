import { describe, expect, it } from "vitest";

import { getDefaultPermissions } from "@kan/shared";

describe("time tracking default permissions", () => {
  it("grants administrators every time tracking permission", () => {
    expect(getDefaultPermissions("admin")).toEqual(
      expect.arrayContaining([
        "worklog:view",
        "worklog:create",
        "worklog:edit",
        "worklog:delete",
        "worklog:manage",
      ]),
    );
  });

  it("grants members worklog CRUD without global management", () => {
    const permissions = getDefaultPermissions("member");

    expect(permissions).toEqual(
      expect.arrayContaining([
        "worklog:view",
        "worklog:create",
        "worklog:edit",
        "worklog:delete",
      ]),
    );
    expect(permissions).not.toContain("worklog:manage");
  });

  it("does not expose worklogs to guests by default", () => {
    expect(
      getDefaultPermissions("guest").filter((permission) =>
        permission.startsWith("worklog:"),
      ),
    ).toEqual([]);
  });
});
