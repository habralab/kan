import { describe, expect, it } from "vitest";

import {
  encodeCsvCell,
  encodeCsvRow,
  encodeTimeTrackingEntriesCsvRow,
  encodeTimeTrackingSummaryCsvRow,
  formatCsvDuration,
  getTimeTrackingCsvMemberDisplayName,
  getTimeTrackingCsvMemberEmail,
  getTimeTrackingExportFilename,
  getTimeTrackingSourceTimestamp,
  TIME_TRACKING_DETAILED_CSV_HEADERS,
  TIME_TRACKING_ENTRIES_CSV_HEADERS,
  TIME_TRACKING_SUMMARY_CSV_HEADERS,
} from "./timeTrackingCsv";

describe("time tracking CSV", () => {
  it("quotes text and escapes quotes and line breaks", () => {
    expect(encodeCsvRow(["A, B", 'said "yes"', "line\nbreak", 90])).toBe(
      '"A, B","said ""yes""","line\nbreak",90\r\n',
    );
  });

  it.each(["=1+1", "+cmd", "-2+3", "@SUM(A1)", "\t=1+1", "\r=1+1"])(
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

  it("names an unbounded export as all time", () => {
    expect(
      getTimeTrackingExportFilename({
        boardName: "Product",
        boardPublicId: "board1234567",
        profileName: "entries",
      }),
    ).toBe("kan-time-product-board1234567-all-time-entries.csv");
  });

  it("encodes one aggregated summary row", () => {
    expect(
      encodeTimeTrackingSummaryCsvRow({
        groupBy: "card",
        groupLabel: "Migration, phase 2",
        durationSeconds: 3661,
        entryCount: 3,
        boardName: "Operations",
      }),
    ).toBe(
      '"card","Migration, phase 2","01:01:01",3661,3,"Operations"\r\n',
    );
  });

  it("encodes one analysis-friendly entry row", () => {
    expect(
      encodeTimeTrackingEntriesCsvRow({
        workDate: "2026-08-27",
        durationSeconds: 14_400,
        memberName: "Gandalf the White",
        memberEmail: "mithrandir@istari.valinor",
        boardName: "Analytics",
        cardName: "Author export",
        cardNumber: 9,
        listName: "Done",
        labels: "Research; Export",
        comment: null,
      }),
    ).toBe(
      '"2026-08-27","04:00:00",14400,"Gandalf the White","mithrandir@istari.valinor","Analytics","Author export",9,"Done","Research; Export",\r\n',
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
      "Group",
      "Duration",
      "Duration seconds",
      "Entry count",
      "Board",
    ]);
  });

  it("keeps stable entries headers", () => {
    expect(TIME_TRACKING_ENTRIES_CSV_HEADERS).toEqual([
      "Date",
      "Duration",
      "Duration seconds",
      "Member",
      "Member email",
      "Board",
      "Card",
      "Card number",
      "List",
      "Labels",
      "Comment",
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
      "Source provider",
      "Source entry ID",
      "Source created at",
      "Source timestamp timezone",
      "Source created by",
      "Source created by ID",
      "Source updated at",
      "Source updated by",
      "Source updated by ID",
    ]);
  });

  it("prefers normalized source timestamps and preserves unzoned raw values", () => {
    const normalized = new Date("2026-08-29T08:46:00Z");

    expect(
      getTimeTrackingSourceTimestamp(normalized, "2026-08-29 11:46:00"),
    ).toBe(normalized);
    expect(getTimeTrackingSourceTimestamp(null, "2026-08-29 11:46:00")).toBe(
      "2026-08-29 11:46:00",
    );
    expect(getTimeTrackingSourceTimestamp(null, null)).toBeNull();
  });
});
