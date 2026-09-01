type CsvValue = string | number | Date | null | undefined;

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
