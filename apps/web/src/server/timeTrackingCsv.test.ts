import { describe, expect, it } from "vitest";

import {
  encodeCsvCell,
  encodeCsvRow,
  formatCsvDuration,
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
});
