export const CARD_DUE_REMINDER_QUEUE = "card-due-reminder";

export function reminderInstant(dueDate: Date, minutesBeforeDue: number): Date {
  return new Date(dueDate.getTime() - minutesBeforeDue * 60_000);
}
