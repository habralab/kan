import { describe, expect, it } from "vitest";

import {
  encodeCsvCell,
  encodeCsvRow,
  encodeTimeTrackingSummaryCsvRow,
  formatCsvDuration,
  getTimeTrackingCsvMemberDisplayName,
  getTimeTrackingCsvMemberEmail,
  getTimeTrackingExportFilename,
  TIME_TRACKING_DETAILED_CSV_HEADERS,
  TIME_TRACKING_SUMMARY_CSV_HEADERS,
} from "./timeTrackingCsv";

describe("time tracking CSV", () => {
  it("quotes text and escapes quotes and line breaks", () => {
    expect(encodeCsvRow(["A, B", 'said "yes"', "line\nbreak", 90])).toBe(
      '"A, B","said ""yes""","line\nbreak",90\r\n',
    );
  });

  it.each(["=1+1", "+cmd", "-2+3", "@SUM(A1)"])(
    "neutralizes spreadsheet formula %s",
    (value) => {
      expect(encodeCsvCell(value)).toBe(`"'${value}"`);
    },
  );

  it("formats duration without losing seconds", () => {
    expect(formatCsvDuration(3661)).toBe("01:01:01");
  });

  it("builds a safe filename from the board name", () => {
    expect(
      getTimeTrackingExportFilename({
        boardName: "Marketing / Q3 🚀",
        boardPublicId: "board1234567",
        dateFrom: "2026-09-01",
        dateTo: "2026-09-30",
        profileName: "summary-card",
      }),
    ).toBe(
      "kan-time-marketing-q3-board1234567-2026-09-01-2026-09-30-summary-card.csv",
    );
  });

  it("keeps non-ASCII board names out of the response header", () => {
    expect(
      getTimeTrackingExportFilename({
        boardName: "Общая доска маркетинга",
        boardPublicId: "board1234567",
        dateFrom: "2026-09-01",
        dateTo: "2026-09-30",
        profileName: "detailed",
      }),
    ).toBe("kan-time-board-board1234567-2026-09-01-2026-09-30-detailed.csv");
  });

  it("encodes one aggregated summary row", () => {
    expect(
      encodeTimeTrackingSummaryCsvRow({
        groupBy: "card",
        groupPublicId: "card12345678",
        groupLabel: "Migration, phase 2",
        durationSeconds: 3661,
        entryCount: 3,
        boardName: "Operations",
        boardPublicId: "board1234567",
      }),
    ).toBe(
      '"card","card12345678","Migration, phase 2",3661,"01:01:01",3,"Operations","board1234567"\r\n',
    );
  });

  it("does not expose a hidden member email", () => {
    const member = {
      publicId: "member123456",
      email: "hidden@example.com",
      displayName: null,
      userEmail: "account@example.com",
      showEmailsToMembers: false,
    };

    expect(getTimeTrackingCsvMemberDisplayName(member)).toBe(
      "anonymous_member123456",
    );
    expect(getTimeTrackingCsvMemberEmail(member)).toBeNull();
  });

  it("keeps stable summary headers", () => {
    expect(TIME_TRACKING_SUMMARY_CSV_HEADERS).toEqual([
      "Group by",
      "Group ID",
      "Group",
      "Duration seconds",
      "Duration",
      "Entry count",
      "Board",
      "Board ID",
    ]);
  });

  it("keeps stable detailed headers", () => {
    expect(TIME_TRACKING_DETAILED_CSV_HEADERS).toEqual([
      "Worklog ID",
      "Date",
      "Duration seconds",
      "Member ID",
      "Member",
      "Member email",
      "Board ID",
      "Board",
      "Card ID",
      "Card",
      "Card number",
      "List ID",
      "List",
      "Label IDs",
      "Labels",
      "Entry method",
      "Timer started at",
      "Timer stopped at",
      "Timer timezone",
      "Raw elapsed seconds",
      "Comment",
      "Created at",
      "Created by",
      "Updated at",
      "Updated by",
    ]);
  });
});
