import { t } from "@lingui/core/macro";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from "date-fns";
import { useId, useMemo, useState } from "react";
import { HiChevronLeft, HiChevronRight } from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

interface DateSelectorCalendarProps {
  selectedDate?: Date | null;
  rangeStartDate?: Date | null;
  onDateSelect?: (date: Date | undefined, source?: "calendar" | "time") => void;
  weekStartsOn?: 0 | 1 | 6;
  timeEnabled?: boolean;
  defaultTime?: string;
  allowDateClear?: boolean;
  className?: string;
}

interface DateSelectorTimeControlProps {
  selectedDate?: Date | null;
  onDateSelect?: (date: Date | undefined, source?: "calendar" | "time") => void;
  timeEnabled?: boolean;
  onTimeEnabledChange?: (enabled: boolean) => void;
  defaultTime?: string;
  className?: string;
}

interface DateSelectorProps extends DateSelectorCalendarProps {
  showTime?: boolean;
  onTimeEnabledChange?: (enabled: boolean) => void;
}

const parseTime = (time: string) => {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return { hours, minutes };
};

export const DateSelectorCalendar = ({
  selectedDate,
  rangeStartDate,
  onDateSelect,
  weekStartsOn = 1,
  timeEnabled = false,
  defaultTime = "18:00",
  allowDateClear = true,
  className,
}: DateSelectorCalendarProps) => {
  const [currentMonth, setCurrentMonth] = useState(() => {
    return selectedDate ? startOfMonth(selectedDate) : startOfMonth(new Date());
  });

  const monthName = format(currentMonth, "MMMM");
  const year = format(currentMonth, "yyyy");

  const dayHeaders = useMemo(() => {
    const weekStart = startOfWeek(new Date(), { weekStartsOn });
    return eachDayOfInterval({
      start: weekStart,
      end: new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000),
    }).map((date) => format(date, "EEEEEE")); // Shortest localized day name
  }, [weekStartsOn]);

  const days = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn });

    return eachDayOfInterval({ start: calendarStart, end: calendarEnd }).map(
      (date) => {
        const dateString = format(date, "yyyy-MM-dd");
        return {
          date: dateString,
          isToday: isToday(date),
          isSelected: selectedDate ? isSameDay(date, selectedDate) : false,
          isRangeStart: rangeStartDate
            ? isSameDay(date, rangeStartDate)
            : false,
          isInRange:
            selectedDate && rangeStartDate
              ? isAfter(date, rangeStartDate) && isBefore(date, selectedDate)
              : false,
          isCurrentMonth: date >= monthStart && date <= monthEnd,
          dateObj: date,
        };
      },
    );
  }, [currentMonth, rangeStartDate, selectedDate, weekStartsOn]);

  const handlePreviousMonth = () => {
    setCurrentMonth(subMonths(currentMonth, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(addMonths(currentMonth, 1));
  };

  const handleDateClick = (date: Date, e: React.MouseEvent) => {
    e.stopPropagation();
    // Existing pickers clear a selected day on the second click. Range pickers
    // can keep it so the caller can treat the click as a same-day range.
    if (allowDateClear && selectedDate && isSameDay(date, selectedDate)) {
      onDateSelect?.(undefined, "calendar");
    } else if (!timeEnabled) {
      onDateSelect?.(date, "calendar");
    } else {
      const selectedTime = selectedDate
        ? {
            hours: selectedDate.getHours(),
            minutes: selectedDate.getMinutes(),
            seconds: selectedDate.getSeconds(),
            milliseconds: selectedDate.getMilliseconds(),
          }
        : { ...parseTime(defaultTime), seconds: 0, milliseconds: 0 };
      const dateWithSelectedTime = new Date(date);
      dateWithSelectedTime.setHours(
        selectedTime.hours,
        selectedTime.minutes,
        selectedTime.seconds,
        selectedTime.milliseconds,
      );
      onDateSelect?.(dateWithSelectedTime, "calendar");
    }
  };

  return (
    <div className={twMerge("w-[250px] p-4", className)}>
      <div className="flex items-center text-light-1000 dark:text-dark-1000">
        <button
          type="button"
          onClick={handlePreviousMonth}
          className="flex flex-none items-center justify-center p-1.5 text-light-700 hover:text-light-900 dark:text-dark-700 dark:hover:text-dark-1000"
        >
          <span className="sr-only">Previous month</span>
          <HiChevronLeft aria-hidden="true" className="h-4 w-4" />
        </button>
        <div className="flex-1 text-center text-sm font-semibold">
          {monthName} {year}
        </div>
        <button
          type="button"
          onClick={handleNextMonth}
          className="flex flex-none items-center justify-center p-1.5 text-light-700 hover:text-light-900 dark:text-dark-700 dark:hover:text-dark-1000"
        >
          <span className="sr-only">Next month</span>
          <HiChevronRight aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-6 grid grid-cols-7 text-center text-xs/6 text-light-950 dark:text-dark-950">
        {dayHeaders.map((day, index) => (
          <div key={index}>{day}</div>
        ))}
      </div>
      <div className="isolate mt-2 grid grid-cols-7 text-sm">
        {days.map((day) => (
          <button
            key={day.date}
            type="button"
            onClick={(e) => handleDateClick(day.dateObj, e)}
            className={twMerge(
              "flex aspect-square items-center justify-center rounded-lg focus:z-10",
              day.isSelected || day.isRangeStart
                ? "bg-light-1000 hover:bg-light-1000 dark:bg-dark-1000 dark:hover:bg-dark-1000"
                : day.isInRange
                  ? "rounded-none bg-light-200 hover:bg-light-300 dark:bg-dark-200 dark:hover:bg-dark-300"
                  : "bg-transparent hover:bg-light-200 dark:bg-transparent dark:hover:bg-dark-200",
            )}
          >
            <time
              dateTime={day.date}
              className={twMerge(
                "mx-auto flex size-7 items-center justify-center rounded-full text-light-900 dark:text-dark-900",
                day.isCurrentMonth
                  ? "text-light-900 dark:text-dark-900"
                  : "text-light-700 dark:text-dark-600",
                (day.isSelected || day.isRangeStart) &&
                  "text-light-50 dark:text-dark-50",
              )}
            >
              {day.date.split("-").pop()?.replace(/^0/, "")}
            </time>
          </button>
        ))}
      </div>
    </div>
  );
};

export const DateSelectorTimeControl = ({
  selectedDate,
  onDateSelect,
  timeEnabled = false,
  onTimeEnabledChange,
  defaultTime = "18:00",
  className,
}: DateSelectorTimeControlProps) => {
  const timeInputId = useId();

  const handleTimeChange = (time: string) => {
    if (!selectedDate) return;

    const { hours, minutes } = parseTime(time);
    const dateWithUpdatedTime = new Date(selectedDate);
    dateWithUpdatedTime.setHours(hours, minutes, 0, 0);
    onDateSelect?.(dateWithUpdatedTime, "time");
  };

  const handleTimeEnabledChange = (enabled: boolean) => {
    onTimeEnabledChange?.(enabled);
    if (!selectedDate) return;

    const updatedDate = new Date(selectedDate);
    if (enabled) {
      const { hours, minutes } = parseTime(defaultTime);
      updatedDate.setHours(hours, minutes, 0, 0);
    } else {
      updatedDate.setHours(0, 0, 0, 0);
    }
    onDateSelect?.(updatedDate, "time");
  };

  return (
    <div
      className={twMerge(
        "flex items-center justify-between gap-3 text-sm text-light-900 dark:text-dark-900",
        className,
      )}
    >
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          className="h-[14px] w-[14px] rounded bg-transparent"
          checked={timeEnabled}
          onChange={(event) => handleTimeEnabledChange(event.target.checked)}
        />
        {t`Time`}
      </label>
      {timeEnabled && (
        <input
          id={timeInputId}
          aria-label={t`Time`}
          type="time"
          value={selectedDate ? format(selectedDate, "HH:mm") : defaultTime}
          disabled={!selectedDate}
          onChange={(event) => handleTimeChange(event.target.value)}
          className="rounded-md border border-light-300 bg-light-50 px-2 py-1 text-sm text-light-1000 disabled:cursor-not-allowed disabled:opacity-50 dark:border-dark-300 dark:bg-dark-100 dark:text-dark-1000"
        />
      )}
    </div>
  );
};

const DateSelector = ({
  showTime = false,
  onTimeEnabledChange,
  ...calendarProps
}: DateSelectorProps) => (
  <div className={twMerge("w-[250px]", calendarProps.className)}>
    <DateSelectorCalendar {...calendarProps} className="w-full pb-0" />
    {showTime && (
      <DateSelectorTimeControl
        selectedDate={calendarProps.selectedDate}
        onDateSelect={calendarProps.onDateSelect}
        timeEnabled={calendarProps.timeEnabled}
        onTimeEnabledChange={onTimeEnabledChange}
        defaultTime={calendarProps.defaultTime}
        className="mt-4 px-4 pb-4"
      />
    )}
  </div>
);

export default DateSelector;
