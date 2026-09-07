import { describe, expect, it } from "vitest";

import { parseTimeTrackingRecoveryArguments } from "./time-tracking-recovery";

describe("time tracking import recovery arguments", () => {
  it("defaults to a dry run", () => {
    expect(
      parseTimeTrackingRecoveryArguments([
        "run123456789",
        "--reason",
        "Worker was terminated after the host rebooted",
      ]),
    ).toEqual({
      importRunPublicId: "run123456789",
      reason: "Worker was terminated after the host rebooted",
      apply: false,
    });
  });

  it("requires an explicit apply flag before mutation", () => {
    expect(
      parseTimeTrackingRecoveryArguments([
        "run123456789",
        "--reason",
        "Worker was terminated after the host rebooted",
        "--apply",
      ]).apply,
    ).toBe(true);
  });

  it("rejects ambiguous or incomplete arguments", () => {
    expect(() =>
      parseTimeTrackingRecoveryArguments([
        "run123456789",
        "--reason",
        "too short",
      ]),
    ).toThrow("--reason must contain at least 10 characters");
    expect(() =>
      parseTimeTrackingRecoveryArguments([
        "run123456789",
        "--reason",
        "Worker was terminated after the host rebooted",
        "--apply",
        "--apply",
      ]),
    ).toThrow("--apply may only be provided once");
    expect(() =>
      parseTimeTrackingRecoveryArguments([
        "run123456789",
        "--reason",
        "Worker was terminated after the host rebooted",
        "--force",
      ]),
    ).toThrow("Unknown argument: --force");
  });
});
