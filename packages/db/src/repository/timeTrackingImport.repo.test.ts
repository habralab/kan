import { describe, expect, it } from "vitest";

import {
  accumulateTimeTrackingImportResults,
  assertTimeTrackingImportCountersComplete,
  createEmptyTimeTrackingImportCounters,
} from "./timeTrackingImport.repo";

describe("time tracking import counters", () => {
  it("accounts for each worklog disposition exactly once", () => {
    const counters = createEmptyTimeTrackingImportCounters(4, 600);
    const records = [
      { externalId: "worklog-1", durationSeconds: 60 },
      { externalId: "worklog-2", durationSeconds: 120 },
      { externalId: "worklog-3", durationSeconds: 180 },
      { externalId: "worklog-4", durationSeconds: 240 },
    ];

    accumulateTimeTrackingImportResults(
      counters,
      records,
      [
        { externalId: "worklog-1", disposition: "inserted" },
        { externalId: "worklog-2", disposition: "updated" },
        { externalId: "worklog-3", disposition: "skipped" },
        { externalId: "worklog-4", disposition: "conflict" },
      ],
      "worklogs",
    );

    expect(counters).toMatchObject({
      insertedRecords: 1,
      insertedSeconds: 60,
      updatedRecords: 1,
      skippedRecords: 1,
      quarantinedRecords: 0,
      conflictRecords: 1,
    });
    expect(() =>
      assertTimeTrackingImportCountersComplete(counters),
    ).not.toThrow();
  });

  it("accounts for repeated quarantine records only as quarantine", () => {
    const counters = createEmptyTimeTrackingImportCounters(2, 180);
    const records = [
      { externalId: "quarantine-1", durationSeconds: 60 },
      { externalId: "quarantine-2", durationSeconds: 120 },
    ];

    accumulateTimeTrackingImportResults(
      counters,
      records,
      [
        { externalId: "quarantine-1", disposition: "skipped" },
        { externalId: "quarantine-2", disposition: "updated" },
      ],
      "quarantine",
    );

    expect(counters).toMatchObject({
      quarantinedRecords: 2,
      quarantinedSeconds: 180,
      updatedRecords: 0,
      skippedRecords: 0,
      conflictRecords: 0,
    });
    expect(() =>
      assertTimeTrackingImportCountersComplete(counters),
    ).not.toThrow();
  });

  it("rejects incomplete or misaligned result accounting", () => {
    const counters = createEmptyTimeTrackingImportCounters(1, 60);

    expect(() => assertTimeTrackingImportCountersComplete(counters)).toThrow(
      "Import counters account for 0 of 1 records",
    );
    expect(() =>
      accumulateTimeTrackingImportResults(
        counters,
        [{ externalId: "worklog-1", durationSeconds: 60 }],
        [{ externalId: "worklog-2", disposition: "inserted" }],
        "worklogs",
      ),
    ).toThrow("Import result does not match its source record");
  });
});
