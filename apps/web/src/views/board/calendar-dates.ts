import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  format,
} from "date-fns";

export interface CalendarCard {
  publicId: string;
  title: string;
  cardNumber: number | null;
  dueDate: Date | null;
  startDate: Date | null;
  dueDateHasTime: boolean;
  completed: boolean;
  labels: { name: string; colourCode: string | null }[];
}

export interface CalendarEntry {
  card: CalendarCard;
  position: "single" | "start" | "middle" | "end" | "start-only";
}

export interface CalendarChecklistItem {
  publicId: string;
  title: string;
  completed: boolean;
  dueDate: Date;
  dueDateHasTime: boolean;
  cardPublicId: string;
}

interface CalendarDates {
  startDate: Date | null;
  dueDate: Date | null;
  dueDateHasTime: boolean;
}

export const shiftCalendarDates = (
  card: CalendarDates,
  sourceDate: Date,
  targetDate: Date,
) => {
  const days = differenceInCalendarDays(targetDate, sourceDate);

  return {
    ...(card.startDate && { startDate: addDays(card.startDate, days) }),
    ...(card.dueDate && {
      dueDate: addDays(card.dueDate, days),
      dueDateHasTime: card.dueDateHasTime,
    }),
  };
};

export const getCalendarEntries = (
  lists: { cards: CalendarCard[] }[],
  visibleDates: Date[],
) => {
  const map = new Map<string, CalendarEntry[]>();
  const visibleStart = visibleDates[0];
  const visibleEnd = visibleDates[visibleDates.length - 1];

  if (!visibleStart || !visibleEnd) return map;

  for (const list of lists) {
    for (const card of list.cards) {
      const start = card.startDate ?? card.dueDate;
      const end = card.dueDate ?? card.startDate;
      if (!start || !end) continue;

      // For a legacy start after its due date, show the due day only rather
      // than inventing a range with reversed meaning.
      const rangeStart = start > end ? end : start;
      const firstDay = new Date(
        rangeStart.getFullYear(),
        rangeStart.getMonth(),
        rangeStart.getDate(),
      );
      const lastDay = new Date(
        end.getFullYear(),
        end.getMonth(),
        end.getDate(),
      );
      const from = firstDay > visibleStart ? firstDay : visibleStart;
      const to = lastDay < visibleEnd ? lastDay : visibleEnd;
      if (from > to) continue;

      for (const date of eachDayOfInterval({ start: from, end: to })) {
        const key = format(date, "yyyy-MM-dd");
        const position: CalendarEntry["position"] = !card.dueDate
          ? "start-only"
          : firstDay.getTime() === lastDay.getTime()
            ? "single"
            : date.getTime() === firstDay.getTime()
              ? "start"
              : date.getTime() === lastDay.getTime()
                ? "end"
                : "middle";
        const existing = map.get(key) ?? [];
        existing.push({ card, position });
        map.set(key, existing);
      }
    }
  }

  return map;
};

export const getCalendarChecklistEntries = (
  items: CalendarChecklistItem[],
  visibleDates: Date[],
  visibleCardIds: Set<string>,
) => {
  const map = new Map<string, CalendarChecklistItem[]>();
  const visibleDays = new Set(
    visibleDates.map((date) => format(date, "yyyy-MM-dd")),
  );

  for (const item of items) {
    if (!visibleCardIds.has(item.cardPublicId)) continue;
    const key = format(item.dueDate, "yyyy-MM-dd");
    if (!visibleDays.has(key)) continue;

    const existing = map.get(key) ?? [];
    existing.push(item);
    map.set(key, existing);
  }

  return map;
};
