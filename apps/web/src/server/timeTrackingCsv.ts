type CsvValue = string | number | Date | null | undefined;

export const TIME_TRACKING_SUMMARY_CSV_HEADERS = [
  "Group by",
  "Group ID",
  "Group",
  "Duration seconds",
  "Duration",
  "Entry count",
  "Board",
  "Board ID",
] as const;

export const TIME_TRACKING_ENTRIES_CSV_HEADERS = [
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
] as const;

export const TIME_TRACKING_DETAILED_CSV_HEADERS = [
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
] as const;

export const getTimeTrackingExportFilename = (input: {
  boardName: string;
  boardPublicId: string;
  dateFrom: string;
  dateTo: string;
  profileName: string;
}) => {
  const boardToken =
    input.boardName
      .normalize("NFKD")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 80) || "board";

  return `kan-time-${boardToken}-${input.boardPublicId}-${input.dateFrom}-${input.dateTo}-${input.profileName}.csv`;
};

interface CsvMember {
  publicId: string;
  email: string;
  displayName: string | null;
  userEmail: string | null;
  showEmailsToMembers: boolean;
}

export const getTimeTrackingCsvMemberDisplayName = (member: CsvMember) => {
  const name = member.displayName?.trim();
  if (name) return name;
  if (member.showEmailsToMembers) return member.userEmail ?? member.email;
  return `anonymous_${member.publicId}`;
};

export const getTimeTrackingCsvMemberEmail = (member: CsvMember) =>
  member.showEmailsToMembers ? (member.userEmail ?? member.email) : null;

export const encodeTimeTrackingSummaryCsvRow = (input: {
  groupBy: string;
  groupPublicId: string;
  groupLabel: string;
  durationSeconds: number;
  entryCount: number;
  boardName: string;
  boardPublicId: string;
}) =>
  encodeCsvRow([
    input.groupBy,
    input.groupPublicId,
    input.groupLabel,
    input.durationSeconds,
    formatCsvDuration(input.durationSeconds),
    input.entryCount,
    input.boardName,
    input.boardPublicId,
  ]);

export const encodeTimeTrackingEntriesCsvRow = (input: {
  workDate: string;
  durationSeconds: number;
  memberName: string;
  memberEmail: string | null;
  boardName: string;
  cardName: string;
  cardNumber: number | null;
  listName: string | null;
  labels: string;
  comment: string | null;
}) =>
  encodeCsvRow([
    input.workDate,
    formatCsvDuration(input.durationSeconds),
    input.durationSeconds,
    input.memberName,
    input.memberEmail,
    input.boardName,
    input.cardName,
    input.cardNumber,
    input.listName,
    input.labels,
    input.comment,
  ]);

const protectSpreadsheetFormula = (value: string) =>
  /^[=+\-@]/.test(value) ? `'${value}` : value;

export const encodeCsvCell = (value: CsvValue) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value.toString();

  const text = protectSpreadsheetFormula(
    value instanceof Date ? value.toISOString() : value,
  );
  return `"${text.replaceAll('"', '""')}"`;
};

export const encodeCsvRow = (values: readonly CsvValue[]) =>
  `${values.map(encodeCsvCell).join(",")}\r\n`;

export const formatCsvDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return [hours, minutes, remainingSeconds]
    .map((value) => value.toString().padStart(2, "0"))
    .join(":");
};
