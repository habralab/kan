import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  loadTimeTrackingImportPlan,
  parseTimeTrackingImportPlanArguments,
  sha256,
} from "@kan/db/timeTrackingImportPlan";

const temporaryRoots: string[] = [];

const createRoot = () => {
  const root = mkdtempSync(join(tmpdir(), "kan-time-import-plan-"));
  temporaryRoots.push(root);
  return root;
};

const sourceFields = {
  externalId: "source:1",
  externalBoardId: "external-board",
  externalCardId: "external-card",
  externalMemberId: "external-member",
  sourceCreatedAt: "2026-09-01T10:00:00.000Z",
  sourceUpdatedAt: null,
  sourceCreatedAtRaw: null,
  sourceUpdatedAtRaw: null,
  sourceTimestampTimezone: "UTC",
  sourceCreatedByExternalMemberId: null,
  sourceCreatedByDisplayName: null,
  sourceUpdatedByExternalMemberId: null,
  sourceUpdatedByDisplayName: null,
  billable: null,
  invoiced: null,
  sourceHash: "a".repeat(64),
};

const worklog = {
  ...sourceFields,
  boardPublicId: "board1234567",
  cardPublicId: "card12345678",
  workspaceMemberPublicId: "member123456",
  workDate: "2026-09-01",
  durationSeconds: 3600,
  comment: "Imported entry",
};

const createManifest = (
  files: { name: string; contents: string }[],
  counters = {
    inputRecords: 1,
    inputSeconds: 3600,
    importableRecords: 1,
    importableSeconds: 3600,
    quarantinedRecords: 0,
    quarantinedSeconds: 0,
  },
) => ({
  format: "kan-time-tracking-import-plan-v1",
  schemaVersion: 2,
  planId: "test-plan",
  provider: "test-provider",
  bundleVersion: "test-bundle",
  counters,
  files: files.map(({ name, contents }) => ({
    name,
    bytes: Buffer.byteLength(contents),
    sha256: sha256(contents),
  })),
});

const writePlan = (
  root: string,
  options: {
    worklogs?: string;
    quarantine?: string;
    manifestFiles?: { name: string; contents: string }[];
  } = {},
) => {
  const worklogs = options.worklogs ?? `${JSON.stringify(worklog)}\n`;
  const quarantine = options.quarantine ?? "";
  writeFileSync(join(root, "worklogs.jsonl"), worklogs);
  writeFileSync(join(root, "quarantine.jsonl"), quarantine);
  const manifestFiles = options.manifestFiles ?? [
    { name: "worklogs.jsonl", contents: worklogs },
    { name: "quarantine.jsonl", contents: quarantine },
  ];
  writeFileSync(
    join(root, "manifest.json"),
    JSON.stringify(createManifest(manifestFiles)),
  );
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe("time tracking import plan", () => {
  it("rejects ambiguous or unknown command-line flags", () => {
    expect(() =>
      parseTimeTrackingImportPlanArguments(["plan", "--udpate-existing"]),
    ).toThrow("Unknown argument: --udpate-existing");
    expect(() =>
      parseTimeTrackingImportPlanArguments(["plan", "--apply", "--preflight"]),
    ).toThrow("--apply and --preflight are mutually exclusive");
    expect(() =>
      parseTimeTrackingImportPlanArguments(["plan", "--update-existing"]),
    ).toThrow("--update-existing requires --apply");
  });

  it("loads a checksummed provider-neutral plan", () => {
    const root = createRoot();
    writePlan(root);

    const plan = loadTimeTrackingImportPlan(root);

    expect(plan.manifest.planId).toBe("test-plan");
    expect(plan.worklogs).toHaveLength(1);
    expect(plan.worklogs[0]?.sourceCreatedAt).toEqual(
      new Date("2026-09-01T10:00:00.000Z"),
    );
    expect(plan.quarantine).toEqual([]);
  });

  it("requires both JSONL payloads to be covered by the manifest", () => {
    const root = createRoot();
    const worklogs = `${JSON.stringify(worklog)}\n`;
    writePlan(root, {
      worklogs,
      manifestFiles: [{ name: "worklogs.jsonl", contents: worklogs }],
    });

    expect(() => loadTimeTrackingImportPlan(root)).toThrow(
      "Required plan file is missing from manifest: quarantine.jsonl",
    );
  });

  it("rejects duplicate manifest entries", () => {
    const root = createRoot();
    const worklogs = `${JSON.stringify(worklog)}\n`;
    writePlan(root, {
      worklogs,
      manifestFiles: [
        { name: "worklogs.jsonl", contents: worklogs },
        { name: "worklogs.jsonl", contents: worklogs },
        { name: "quarantine.jsonl", contents: "" },
      ],
    });

    expect(() => loadTimeTrackingImportPlan(root)).toThrow(
      "Duplicate file in manifest: worklogs.jsonl",
    );
  });

  it("does not read manifest paths outside the plan directory", () => {
    const container = createRoot();
    const root = join(container, "plan");
    mkdirSync(root);
    const outsideContents = "not part of the plan";
    writeFileSync(join(container, "outside.txt"), outsideContents);
    writePlan(root, {
      manifestFiles: [
        {
          name: "worklogs.jsonl",
          contents: `${JSON.stringify(worklog)}\n`,
        },
        { name: "quarantine.jsonl", contents: "" },
        { name: "../outside.txt", contents: outsideContents },
      ],
    });

    expect(() => loadTimeTrackingImportPlan(root)).toThrow(
      "Plan file escapes its directory: ../outside.txt",
    );
  });

  it("does not follow manifest symlinks outside the plan directory", () => {
    const container = createRoot();
    const root = join(container, "plan");
    mkdirSync(root);
    const outsidePath = join(container, "outside.txt");
    const outsideContents = "not part of the plan";
    writeFileSync(outsidePath, outsideContents);
    symlinkSync(outsidePath, join(root, "linked.txt"));
    writePlan(root, {
      manifestFiles: [
        {
          name: "worklogs.jsonl",
          contents: `${JSON.stringify(worklog)}\n`,
        },
        { name: "quarantine.jsonl", contents: "" },
        { name: "linked.txt", contents: outsideContents },
      ],
    });

    expect(() => loadTimeTrackingImportPlan(root)).toThrow(
      "Plan file symlink escapes its directory: linked.txt",
    );
  });

  it("reports malformed JSON with its original line number", () => {
    const root = createRoot();
    writePlan(root, { worklogs: `\n${JSON.stringify(worklog)}\n{broken\n` });

    expect(() => loadTimeTrackingImportPlan(root)).toThrow(
      /worklogs\.jsonl:3: invalid JSON/,
    );
  });

  it("rejects values that cannot be stored in the product schema", () => {
    const root = createRoot();
    const invalid = {
      ...worklog,
      workDate: "2026-02-30",
      durationSeconds: 2_147_483_648,
    };
    writePlan(root, { worklogs: `${JSON.stringify(invalid)}\n` });

    expect(() => loadTimeTrackingImportPlan(root)).toThrow(
      /workDate: Invalid work date.*durationSeconds/,
    );
  });
});
