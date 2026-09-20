import type { DropResult } from "react-beautiful-dnd";
import Link from "next/link";
import { t } from "@lingui/core/macro";
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { useEffect, useMemo, useState } from "react";
import { DragDropContext, Draggable } from "react-beautiful-dnd";
import {
  HiCalendarDays,
  HiCheckCircle,
  HiChevronLeft,
  HiChevronRight,
  HiOutlineCheckCircle,
  HiOutlinePlusSmall,
} from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import type { CalendarCard, CalendarChecklistItem } from "../calendar-dates";
import Button from "~/components/Button";
import LabelIcon from "~/components/LabelIcon";
import { StrictModeDroppable as Droppable } from "~/components/StrictModeDroppable";
import { useLocalisation } from "~/hooks/useLocalisation";
import { isPlaceholderPublicId } from "~/utils/helpers";
import {
  getCalendarChecklistEntries,
  getCalendarEntries,
} from "../calendar-dates";

const MAX_CARDS_PER_DAY = 3;

interface CalendarViewProps {
  lists: { cards: CalendarCard[] }[];
  checklistItems: CalendarChecklistItem[];
  scope: "month" | "week";
  currentDate: Date;
  onPeriodChange: (scope: "month" | "week", date: Date) => void;
  cardPrefix: string;
  weekStartsOn: 0 | 1 | 6;
  isTemplate: boolean;
  boardId: string;
  canEditCard: boolean;
  canCreateCard: boolean;
  cardReturnQuery: string;
  isLocked: boolean;
  upgradeUrl: string;
  onDateClick: (date: Date) => void;
  onCardDrop: (card: CalendarCard, sourceDate: Date, targetDate: Date) => void;
}

const CalendarView = ({
  lists,
  checklistItems,
  scope,
  currentDate,
  onPeriodChange,
  cardPrefix,
  weekStartsOn,
  isTemplate,
  boardId,
  canEditCard,
  canCreateCard,
  cardReturnQuery,
  isLocked,
  upgradeUrl,
  onDateClick,
  onCardDrop,
}: CalendarViewProps) => {
  const { dateLocale } = useLocalisation();
  const [selectedDate, setSelectedDate] = useState(currentDate);
  const [expandedDayKey, setExpandedDayKey] = useState<string | null>(null);

  useEffect(() => {
    setSelectedDate(currentDate);
  }, [currentDate]);

  const cardHref = (cardPublicId: string) =>
    isTemplate
      ? `/templates/${boardId}/cards/${cardPublicId}${cardReturnQuery}`
      : `/cards/${cardPublicId}${cardReturnQuery}`;

  const ticketNumber = (card: CalendarCard) =>
    card.cardNumber != null ? `${cardPrefix}-${card.cardNumber}` : null;

  const calendarDates = useMemo(() => {
    const calendarStart = startOfWeek(
      scope === "week" ? currentDate : startOfMonth(currentDate),
      { weekStartsOn },
    );
    const calendarEnd =
      scope === "week"
        ? addDays(calendarStart, 6)
        : endOfWeek(endOfMonth(currentDate), { weekStartsOn });

    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [currentDate, scope, weekStartsOn]);

  const cardsByDay = useMemo(
    () => getCalendarEntries(lists, calendarDates),
    [calendarDates, lists],
  );

  const visibleCardsByPublicId = useMemo(
    () =>
      new Map(
        lists.flatMap((list) =>
          list.cards.map((card) => [card.publicId, card] as const),
        ),
      ),
    [lists],
  );

  const visibleCardIds = useMemo(
    () => new Set(visibleCardsByPublicId.keys()),
    [visibleCardsByPublicId],
  );

  const checklistItemsByDay = useMemo(
    () =>
      getCalendarChecklistEntries(
        checklistItems,
        calendarDates,
        visibleCardIds,
      ),
    [calendarDates, checklistItems, visibleCardIds],
  );

  const days = useMemo(() => {
    return calendarDates.map((date) => {
      const key = format(date, "yyyy-MM-dd");
      return {
        date,
        key,
        isCurrentMonth: scope === "week" || isSameMonth(date, currentDate),
        isToday: isToday(date),
        cards: cardsByDay.get(key) ?? [],
        checklistItems: checklistItemsByDay.get(key) ?? [],
      };
    });
  }, [calendarDates, cardsByDay, checklistItemsByDay, currentDate, scope]);

  const dayHeaders = useMemo(() => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn });
    return eachDayOfInterval({
      start: weekStart,
      end: addDays(weekStart, 6),
    }).map((date) => ({
      narrow: format(date, "EEEEE", { locale: dateLocale }),
      short: format(date, "EEE", { locale: dateLocale }),
    }));
  }, [weekStartsOn, dateLocale]);

  const selectedCards = useMemo(
    () => cardsByDay.get(format(selectedDate, "yyyy-MM-dd")) ?? [],
    [cardsByDay, selectedDate],
  );

  const selectedChecklistItems = useMemo(
    () => checklistItemsByDay.get(format(selectedDate, "yyyy-MM-dd")) ?? [],
    [checklistItemsByDay, selectedDate],
  );

  const goToPeriod = (date: Date) => {
    setExpandedDayKey(null);
    const today = new Date();
    const start =
      scope === "week"
        ? startOfWeek(date, { weekStartsOn })
        : startOfMonth(date);
    const end = scope === "week" ? addDays(start, 6) : endOfMonth(date);
    const selection = today >= start && today < addDays(end, 1) ? today : start;
    setSelectedDate(selection);
    onPeriodChange(scope, selection);
  };

  const changeScope = (nextScope: "month" | "week") => {
    onPeriodChange(nextScope, selectedDate);
    setExpandedDayKey(null);
  };

  const previousPeriod = () =>
    goToPeriod(
      scope === "week"
        ? addDays(currentDate, -7)
        : subMonths(startOfMonth(currentDate), 1),
    );

  const nextPeriod = () =>
    goToPeriod(
      scope === "week"
        ? addDays(currentDate, 7)
        : addMonths(startOfMonth(currentDate), 1),
    );

  const handleDragEnd = ({ destination, source }: DropResult) => {
    if (!destination || destination.droppableId === source.droppableId) {
      return;
    }

    const targetDay = days.find((day) => day.key === destination.droppableId);
    const sourceDay = days.find((day) => day.key === source.droppableId);
    const entry = sourceDay?.cards[source.index];
    if (!targetDay || !sourceDay || !entry) return;

    onCardDrop(entry.card, sourceDay.date, targetDay.date);
  };

  const navButtonClasses =
    "flex h-8 w-9 items-center justify-center text-light-900 hover:bg-light-200 hover:text-light-1000 dark:text-dark-900 dark:hover:bg-dark-200 dark:hover:text-dark-1000";
  const dividerClasses = "h-5 w-px bg-light-300 dark:bg-dark-300";

  return (
    <div className="z-0 flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-light-300 px-6 pb-4 dark:border-dark-300 md:px-8">
        <h2 className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
          <time
            dateTime={format(calendarDates[0] ?? currentDate, "yyyy-MM-dd")}
          >
            {scope === "week"
              ? `${format(calendarDates[0] ?? currentDate, "d MMM", { locale: dateLocale })} – ${format(calendarDates[6] ?? currentDate, "d MMM yyyy", { locale: dateLocale })}`
              : format(currentDate, "MMMM yyyy", { locale: dateLocale })}
          </time>
        </h2>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border-[1px] border-light-300 bg-light-50 p-0.5 dark:border-dark-300 dark:bg-dark-50">
            {(["week", "month"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={scope === option}
                onClick={() => changeScope(option)}
                className={twMerge(
                  "rounded-[4px] px-2 py-1 text-xs font-semibold text-light-900 dark:text-dark-900",
                  scope === option &&
                    "bg-light-200 text-light-1000 dark:bg-dark-200 dark:text-dark-1000",
                )}
              >
                {option === "week" ? t`Week` : t`Month`}
              </button>
            ))}
          </div>
          <div className="flex items-center rounded-md border-[1px] border-light-300 bg-light-50 dark:border-dark-300 dark:bg-dark-50">
            <button
              type="button"
              aria-label={
                scope === "week" ? t`Previous week` : t`Previous month`
              }
              onClick={previousPeriod}
              className={twMerge(navButtonClasses, "rounded-l-md")}
            >
              <HiChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <span className={dividerClasses} />
            <button
              type="button"
              onClick={() => goToPeriod(new Date())}
              className="px-3 py-1.5 text-xs font-semibold text-light-1000 hover:bg-light-200 dark:text-dark-1000 dark:hover:bg-dark-200"
            >
              {t`Today`}
            </button>
            <span className={dividerClasses} />
            <button
              type="button"
              aria-label={scope === "week" ? t`Next week` : t`Next month`}
              onClick={nextPeriod}
              className={twMerge(navButtonClasses, "rounded-r-md")}
            >
              <HiChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          aria-hidden={isLocked}
          className={twMerge(
            "flex min-h-0 flex-1 flex-col",
            isLocked && "pointer-events-none select-none blur-[6px]",
          )}
        >
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="grid grid-cols-7 gap-px border-b border-light-300 bg-light-300 text-center text-xs font-semibold text-light-900 dark:border-dark-300 dark:bg-dark-300 dark:text-dark-900">
              {dayHeaders.map((day) => (
                <div
                  key={day.short}
                  className="bg-light-100 py-2 dark:bg-dark-100"
                >
                  <span className="sm:hidden">{day.narrow}</span>
                  <span className="hidden sm:inline">{day.short}</span>
                </div>
              ))}
            </div>

            <DragDropContext onDragEnd={handleDragEnd}>
              <div className="hidden min-h-0 flex-1 overflow-y-auto bg-light-300 dark:bg-dark-300 lg:block">
                <div
                  className={twMerge(
                    "grid min-h-full grid-cols-7 gap-px",
                    scope === "week"
                      ? "auto-rows-[minmax(18rem,1fr)]"
                      : "auto-rows-[minmax(7.5rem,max-content)]",
                  )}
                >
                  {days.map((day) => {
                    const isExpanded = expandedDayKey === day.key;
                    const visibleCards = isExpanded
                      ? day.cards
                      : day.cards.slice(0, MAX_CARDS_PER_DAY);
                    const visibleChecklistItems = isExpanded
                      ? day.checklistItems
                      : day.checklistItems.slice(
                          0,
                          MAX_CARDS_PER_DAY - visibleCards.length,
                        );
                    const overflowCount =
                      day.cards.length +
                      day.checklistItems.length -
                      MAX_CARDS_PER_DAY;

                    return (
                      <div
                        key={day.key}
                        onClick={() => canCreateCard && onDateClick(day.date)}
                        className={twMerge(
                          "flex flex-col px-2 py-1.5",
                          day.isCurrentMonth
                            ? "bg-light-50 dark:bg-dark-50"
                            : "bg-light-100 dark:bg-dark-100",
                          canCreateCard && "cursor-pointer",
                        )}
                      >
                        <time
                          dateTime={day.key}
                          className={twMerge(
                            "flex size-6 flex-none items-center justify-center rounded-full text-xs",
                            day.isCurrentMonth
                              ? "text-light-950 dark:text-dark-950"
                              : "text-light-800 dark:text-dark-700",
                            day.isToday &&
                              "bg-light-1000 font-semibold text-light-50 dark:bg-dark-1000 dark:text-dark-50",
                          )}
                        >
                          {format(day.date, "d")}
                        </time>
                        <Droppable droppableId={day.key}>
                          {(provided, snapshot) => (
                            <ol
                              ref={provided.innerRef}
                              {...provided.droppableProps}
                              className={twMerge(
                                "mt-1 flex-1 space-y-px rounded-[4px]",
                                snapshot.isDraggingOver &&
                                  "bg-light-200 dark:bg-dark-200",
                              )}
                            >
                              {visibleCards.map(({ card, position }, index) => (
                                <Draggable
                                  key={`${card.publicId}:${day.key}`}
                                  draggableId={`${card.publicId}:${day.key}`}
                                  index={index}
                                  isDragDisabled={
                                    !canEditCard ||
                                    isPlaceholderPublicId(card.publicId)
                                  }
                                >
                                  {(dragProvided) => (
                                    <li
                                      ref={dragProvided.innerRef}
                                      {...dragProvided.draggableProps}
                                      {...dragProvided.dragHandleProps}
                                    >
                                      <Link
                                        href={cardHref(card.publicId)}
                                        data-calendar-position={position}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (
                                            isPlaceholderPublicId(card.publicId)
                                          ) {
                                            e.preventDefault();
                                          }
                                        }}
                                        className={twMerge(
                                          "group flex items-center gap-1.5 rounded-[4px] px-1 py-0.5 text-xs hover:bg-light-200 dark:hover:bg-dark-200",
                                          position !== "single" &&
                                            "bg-light-200 dark:bg-dark-200",
                                          position === "start" &&
                                            "border-l-2 border-light-700 dark:border-dark-700",
                                          position === "end" &&
                                            "border-r-2 border-light-700 dark:border-dark-700",
                                          position === "start-only" &&
                                            "border-l-2 border-dashed border-light-700 dark:border-dark-700",
                                        )}
                                      >
                                        {card.completed && (
                                          <HiCheckCircle
                                            className="size-3 flex-none text-green-600 dark:text-green-400"
                                            aria-hidden="true"
                                          />
                                        )}
                                        <span className="flex size-2 flex-none items-center">
                                          {card.labels[0] && (
                                            <LabelIcon
                                              colourCode={
                                                card.labels[0].colourCode
                                              }
                                            />
                                          )}
                                        </span>
                                        <span className="flex-auto truncate text-light-1000 dark:text-dark-1000">
                                          {card.title}
                                        </span>
                                        {ticketNumber(card) && (
                                          <span className="hidden flex-none text-light-800 dark:text-dark-800 xl:block">
                                            {ticketNumber(card)}
                                          </span>
                                        )}
                                      </Link>
                                    </li>
                                  )}
                                </Draggable>
                              ))}
                              {provided.placeholder}
                              {visibleChecklistItems.map((item) => (
                                <li key={item.publicId}>
                                  <Link
                                    href={cardHref(item.cardPublicId)}
                                    onClick={(event) => event.stopPropagation()}
                                    className="flex items-center gap-1.5 rounded-[4px] px-1 py-0.5 text-xs text-light-900 hover:bg-light-200 dark:text-dark-900 dark:hover:bg-dark-200"
                                  >
                                    {item.completed ? (
                                      <HiCheckCircle
                                        className="size-3 flex-none text-green-600 dark:text-green-400"
                                        aria-hidden="true"
                                      />
                                    ) : (
                                      <HiOutlineCheckCircle
                                        className="size-3 flex-none"
                                        aria-hidden="true"
                                      />
                                    )}
                                    <span
                                      className={twMerge(
                                        "flex-auto truncate",
                                        item.completed &&
                                          "line-through opacity-60",
                                      )}
                                    >
                                      {item.title}
                                    </span>
                                    <span className="hidden max-w-20 flex-none truncate text-light-700 dark:text-dark-700 xl:block">
                                      ·{" "}
                                      {
                                        visibleCardsByPublicId.get(
                                          item.cardPublicId,
                                        )?.title
                                      }
                                    </span>
                                    {item.dueDateHasTime && (
                                      <time
                                        dateTime={item.dueDate.toISOString()}
                                        className="flex-none"
                                      >
                                        {format(item.dueDate, "p", {
                                          locale: dateLocale,
                                        })}
                                      </time>
                                    )}
                                  </Link>
                                </li>
                              ))}
                              {overflowCount > 0 && (
                                <li>
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setExpandedDayKey(
                                        isExpanded ? null : day.key,
                                      );
                                    }}
                                    className="px-1 text-xs text-light-800 hover:text-light-1000 dark:text-dark-800 dark:hover:text-dark-1000"
                                  >
                                    {isExpanded
                                      ? t`Show less`
                                      : t`+ ${overflowCount} more`}
                                  </button>
                                </li>
                              )}
                            </ol>
                          )}
                        </Droppable>
                      </div>
                    );
                  })}
                </div>
              </div>
            </DragDropContext>

            <div className="min-h-0 flex-1 overflow-y-auto bg-light-300 dark:bg-dark-300 lg:hidden">
              <div className="isolate grid min-h-full auto-rows-[minmax(3.5rem,1fr)] grid-cols-7 gap-px">
                {days.map((day) => {
                  const isSelected = isSameDay(day.date, selectedDate);

                  return (
                    <button
                      key={day.key}
                      type="button"
                      onClick={() => {
                        setSelectedDate(day.date);
                        onPeriodChange(scope, day.date);
                      }}
                      className={twMerge(
                        "flex min-h-14 flex-col items-center justify-start gap-1 px-1 py-1.5 focus:z-10",
                        day.isCurrentMonth
                          ? "bg-light-50 dark:bg-dark-50"
                          : "bg-light-100 dark:bg-dark-100",
                      )}
                    >
                      <time
                        dateTime={day.key}
                        className={twMerge(
                          "flex size-6 flex-none items-center justify-center rounded-full text-xs",
                          day.isCurrentMonth
                            ? "text-light-950 dark:text-dark-950"
                            : "text-light-800 dark:text-dark-700",
                          day.isToday &&
                            "font-semibold text-light-1000 dark:text-dark-1000",
                          isSelected &&
                            "bg-light-1000 font-semibold text-light-50 dark:bg-dark-1000 dark:text-dark-50",
                        )}
                      >
                        {format(day.date, "d")}
                      </time>
                      <span className="sr-only">
                        {t`Scheduled items: ${day.cards.length + day.checklistItems.length}`}
                      </span>
                      <span className="flex flex-wrap justify-center gap-0.5">
                        {day.cards.map(({ card }) => (
                          <span
                            key={card.publicId}
                            className="size-1.5 rounded-full bg-light-800 dark:bg-dark-700"
                          />
                        ))}
                        {day.checklistItems.map((item) => (
                          <span
                            key={item.publicId}
                            className="size-1.5 rounded-full bg-light-600 dark:bg-dark-500"
                          />
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-light-300 px-6 py-4 dark:border-dark-300 lg:hidden">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-light-900 dark:text-dark-900">
                  {format(selectedDate, "EEEE d MMMM", { locale: dateLocale })}
                </h3>
                {canCreateCard && (
                  <button
                    type="button"
                    onClick={() => onDateClick(selectedDate)}
                    className="flex items-center gap-1 rounded-[5px] px-2 py-1 text-xs font-semibold text-light-900 hover:bg-light-200 dark:text-dark-900 dark:hover:bg-dark-200"
                  >
                    <HiOutlinePlusSmall
                      className="h-4 w-4"
                      aria-hidden="true"
                    />
                    {t`Add card`}
                  </button>
                )}
              </div>
              {selectedCards.length + selectedChecklistItems.length === 0 ? (
                <p className="text-sm text-light-900 dark:text-dark-900">
                  {t`No cards scheduled`}
                </p>
              ) : (
                <ol className="divide-y divide-light-200 overflow-hidden rounded-md border-[1px] border-light-200 bg-light-50 dark:divide-dark-200 dark:border-dark-200 dark:bg-dark-50">
                  {selectedCards.map(({ card }) => (
                    <li key={card.publicId}>
                      <Link
                        href={cardHref(card.publicId)}
                        onClick={(e) => {
                          if (isPlaceholderPublicId(card.publicId)) {
                            e.preventDefault();
                          }
                        }}
                        className="flex items-center gap-2 p-3 hover:bg-light-100 dark:hover:bg-dark-100"
                      >
                        {card.completed && (
                          <HiCheckCircle
                            className="size-4 flex-none text-green-600 dark:text-green-400"
                            aria-hidden="true"
                          />
                        )}
                        <span className="flex size-2 flex-none items-center">
                          {card.labels[0] && (
                            <LabelIcon colourCode={card.labels[0].colourCode} />
                          )}
                        </span>
                        <span className="flex-auto truncate text-sm text-light-1000 dark:text-dark-1000">
                          {card.title}
                        </span>
                        {ticketNumber(card) && (
                          <span className="flex-none text-xs text-light-800 dark:text-dark-800">
                            {ticketNumber(card)}
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                  {selectedChecklistItems.map((item) => (
                    <li key={item.publicId}>
                      <Link
                        href={cardHref(item.cardPublicId)}
                        className="flex items-center gap-2 p-3 hover:bg-light-100 dark:hover:bg-dark-100"
                      >
                        {item.completed ? (
                          <HiCheckCircle
                            className="size-4 flex-none text-green-600 dark:text-green-400"
                            aria-hidden="true"
                          />
                        ) : (
                          <HiOutlineCheckCircle
                            className="size-4 flex-none"
                            aria-hidden="true"
                          />
                        )}
                        <span className="min-w-0 flex-auto">
                          <span
                            className={twMerge(
                              "block truncate text-sm text-light-1000 dark:text-dark-1000",
                              item.completed && "line-through opacity-60",
                            )}
                          >
                            {item.title}
                          </span>
                          <span className="mt-0.5 flex items-center gap-2 text-xs text-light-700 dark:text-dark-700">
                            <span className="truncate">
                              {
                                visibleCardsByPublicId.get(item.cardPublicId)
                                  ?.title
                              }
                            </span>
                            {item.dueDateHasTime && (
                              <time
                                dateTime={item.dueDate.toISOString()}
                                className="flex-none"
                              >
                                {format(item.dueDate, "p", {
                                  locale: dateLocale,
                                })}
                              </time>
                            )}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>

        {isLocked && (
          <div className="absolute inset-0 flex items-center justify-center bg-light-50/25 p-6 dark:bg-dark-50/25">
            <div className="w-full max-w-[22rem] rounded-xl border-[1px] border-light-600 bg-light-50 p-7 text-center shadow-lg dark:border-dark-600 dark:bg-dark-50">
              <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl border border-light-300 bg-light-200 text-light-1000 dark:border-dark-600 dark:bg-dark-200 dark:text-dark-1000">
                <HiCalendarDays className="h-4 w-4" />
              </div>
              <h3 className="mb-2 text-base font-bold text-light-1000 dark:text-dark-1000">
                {t`Never lose track of what's due`}
              </h3>
              <p className="mb-5 text-sm leading-relaxed text-light-900 dark:text-dark-900">
                {t`See all your cards across the month, then drag and drop to reschedule. Available on paid plans.`}
              </p>
              <Button href={upgradeUrl} fullWidth>
                {t`Upgrade`}
              </Button>
              <p className="mt-3 text-xs text-light-800 dark:text-dark-800">
                {t`14-day free trial · cancel anytime`}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CalendarView;
