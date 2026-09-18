import { t } from "@lingui/core/macro";
import { format, parseISO, startOfDay } from "date-fns";
import { useEffect, useId, useState } from "react";
import { HiMiniPlus } from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import type { CardRecurrenceRule } from "@kan/shared/utils";

import Button from "~/components/Button";
import {
  DateSelectorCalendar,
  DateSelectorTimeControl,
} from "~/components/DateSelector";
import { useLocalisation } from "~/hooks/useLocalisation";
import { usePopup } from "~/providers/popup";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";
import {
  datesMatch,
  formatCardDate,
  getCardDeadlineState,
  orderCardDateRange,
} from "~/utils/cardDates";
import { invalidateCard } from "~/utils/cardInvalidation";

interface CardDatesSelectorProps {
  cardPublicId: string;
  startDate: Date | null | undefined;
  dueDate: Date | null | undefined;
  dueDateHasTime: boolean;
  completed: boolean;
  recurrenceRule: CardRecurrenceRule | null;
  recurrenceTimezone: string | null;
  isLoading?: boolean;
  disabled?: boolean;
}

function copyTime(date: Date, timeSource: Date) {
  const result = new Date(date);
  result.setHours(
    timeSource.getHours(),
    timeSource.getMinutes(),
    timeSource.getSeconds(),
    timeSource.getMilliseconds(),
  );
  return result;
}

export function CardDatesSelector({
  cardPublicId,
  startDate,
  dueDate,
  dueDateHasTime,
  completed,
  recurrenceRule,
  recurrenceTimezone,
  isLoading = false,
  disabled = false,
}: CardDatesSelectorProps) {
  const startDateCheckboxId = useId();
  const { showPopup } = usePopup();
  const { workspace } = useWorkspace();
  const { dateLocale } = useLocalisation();
  const utils = api.useUtils();
  const [isOpen, setIsOpen] = useState(false);
  const [pendingStartDate, setPendingStartDate] = useState<Date | null>(
    startDate ?? null,
  );
  const [pendingDueDate, setPendingDueDate] = useState<Date | null>(
    dueDate ?? null,
  );
  const [pendingHasTime, setPendingHasTime] = useState(dueDateHasTime);
  const [startDateEnabled, setStartDateEnabled] = useState(!!startDate);
  const [rangeAnchor, setRangeAnchor] = useState<Date | null>(null);
  const [pendingRecurrenceRule, setPendingRecurrenceRule] =
    useState<CardRecurrenceRule | null>(recurrenceRule);

  useEffect(() => {
    if (isOpen) return;
    setPendingStartDate(startDate ?? null);
    setPendingDueDate(dueDate ?? null);
    setPendingHasTime(dueDateHasTime);
    setStartDateEnabled(!!startDate);
    setRangeAnchor(null);
    setPendingRecurrenceRule(recurrenceRule);
  }, [dueDate, dueDateHasTime, isOpen, recurrenceRule, startDate]);

  const updateDates = api.card.update.useMutation({
    onMutate: async (update) => {
      await utils.card.byId.cancel({ cardPublicId });
      const previousCard = utils.card.byId.getData({ cardPublicId });

      utils.card.byId.setData({ cardPublicId }, (card) =>
        card
          ? {
              ...card,
              startDate: update.startDate ?? null,
              dueDate: update.dueDate ?? null,
              dueDateHasTime: update.dueDate
                ? (update.dueDateHasTime ?? false)
                : false,
              recurrenceRule: update.recurrenceRule ?? null,
              recurrenceTimezone: update.recurrenceTimezone ?? null,
            }
          : card,
      );

      return { previousCard };
    },
    onError: (_error, _update, context) => {
      utils.card.byId.setData({ cardPublicId }, context?.previousCard);
      showPopup({
        header: t`Unable to update dates`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
    onSuccess: (updatedCard) => {
      utils.card.byId.setData({ cardPublicId }, (card) =>
        card ? { ...card, ...updatedCard } : card,
      );
      setIsOpen(false);
    },
    onSettled: async () => {
      await Promise.all([
        invalidateCard(utils, cardPublicId),
        utils.board.byId.invalidate(),
      ]);
    },
  });

  const open = () => {
    if (disabled) return;
    setPendingStartDate(startDate ?? null);
    setPendingDueDate(dueDate ?? null);
    setPendingHasTime(dueDateHasTime);
    setStartDateEnabled(!!startDate);
    setRangeAnchor(startDate && !dueDate ? startDate : null);
    setPendingRecurrenceRule(recurrenceRule);
    setIsOpen(true);
  };

  const cancel = () => {
    if (updateDates.isPending) return;
    setIsOpen(false);
  };

  const handleCalendarSelect = (
    selectedDate: Date | undefined,
    source?: "calendar" | "time",
  ) => {
    if (!selectedDate) return;

    if (source === "time") {
      setPendingDueDate(selectedDate);
      return;
    }

    if (!startDateEnabled) {
      setPendingDueDate(selectedDate);
      setRangeAnchor(null);
      return;
    }

    if (!rangeAnchor) {
      setPendingStartDate(null);
      setPendingDueDate(selectedDate);
      setRangeAnchor(selectedDate);
      return;
    }

    const range = orderCardDateRange(rangeAnchor, selectedDate);
    if (!range.startDate) {
      setStartDateEnabled(false);
    }
    setPendingStartDate(range.startDate);
    setPendingDueDate(
      pendingHasTime && pendingDueDate
        ? copyTime(range.dueDate, pendingDueDate)
        : range.dueDate,
    );
    setRangeAnchor(null);
  };

  const handleDueDateInput = (value: string) => {
    if (!value) {
      setPendingDueDate(null);
      setPendingStartDate(null);
      setPendingHasTime(false);
      setStartDateEnabled(false);
      setRangeAnchor(null);
      setPendingRecurrenceRule(null);
      return;
    }

    const parsedDate = parseISO(value);
    setPendingDueDate(
      pendingHasTime && pendingDueDate
        ? copyTime(parsedDate, pendingDueDate)
        : parsedDate,
    );
    setRangeAnchor(null);
  };

  const handleStartDateInput = (value: string) => {
    setPendingStartDate(value ? startOfDay(parseISO(value)) : null);
    setRangeAnchor(null);
  };

  const clearDates = () => {
    setPendingStartDate(null);
    setPendingDueDate(null);
    setPendingHasTime(false);
    setStartDateEnabled(false);
    setRangeAnchor(null);
    setPendingRecurrenceRule(null);
  };

  const save = () => {
    let nextStartDate = startDateEnabled ? pendingStartDate : null;
    let nextDueDate = pendingDueDate;

    if (nextStartDate && nextDueDate) {
      const range = orderCardDateRange(nextStartDate, nextDueDate);
      nextStartDate = range.startDate;
      nextDueDate =
        pendingHasTime && pendingDueDate
          ? copyTime(range.dueDate, pendingDueDate)
          : range.dueDate;
    }

    updateDates.mutate({
      cardPublicId,
      startDate: nextStartDate,
      dueDate: nextDueDate,
      dueDateHasTime: nextDueDate ? pendingHasTime : false,
      recurrenceRule: nextDueDate ? pendingRecurrenceRule : null,
      recurrenceTimezone:
        nextDueDate && pendingRecurrenceRule
          ? (recurrenceTimezone ??
            Intl.DateTimeFormat().resolvedOptions().timeZone)
          : null,
    });
  };

  const hasChanges =
    !datesMatch(pendingStartDate, startDate) ||
    !datesMatch(pendingDueDate, dueDate) ||
    (!!pendingDueDate && pendingHasTime !== dueDateHasTime) ||
    pendingRecurrenceRule !== recurrenceRule;
  const draftIsValid =
    !startDateEnabled || (!!pendingStartDate && !!pendingDueDate);

  const formattedStartDate = startDate
    ? formatCardDate(startDate, { locale: dateLocale })
    : null;
  const formattedDueDate = dueDate
    ? formatCardDate(dueDate, {
        locale: dateLocale,
        includeTime: dueDateHasTime,
      })
    : null;
  const deadlineState = dueDate
    ? getCardDeadlineState({ completed, dueDate, dueDateHasTime })
    : null;
  const recurrenceLabel =
    recurrenceRule === "daily"
      ? t`Daily`
      : recurrenceRule === "weekdays"
        ? t`Weekdays`
        : recurrenceRule === "weekly"
          ? t`Weekly`
          : recurrenceRule === "monthly"
            ? t`Monthly`
            : null;

  return (
    <div className="relative flex w-full items-center text-left">
      <button
        type="button"
        onClick={() => (isOpen ? cancel() : open())}
        disabled={isLoading || disabled}
        className={twMerge(
          "flex h-full w-full items-center rounded-[5px] border-[1px] border-light-50 py-1 pl-2 text-left text-xs text-neutral-900 dark:border-dark-50 dark:text-dark-1000",
          disabled
            ? "cursor-not-allowed opacity-60"
            : "hover:border-light-300 hover:bg-light-200 dark:hover:border-dark-200 dark:hover:bg-dark-100",
          deadlineState === "completed" && "text-green-600 dark:text-green-400",
          deadlineState === "overdue" && "text-red-600 dark:text-red-400",
        )}
      >
        {formattedStartDate || formattedDueDate ? (
          <span>
            {formattedStartDate}
            {formattedStartDate && formattedDueDate && " – "}
            {formattedDueDate}
            {recurrenceLabel && ` · ${recurrenceLabel}`}
          </span>
        ) : (
          <>
            <HiMiniPlus size={22} className="pr-2" />
            {t`Set dates`}
          </>
        )}
      </button>
      {isOpen && !disabled && (
        <>
          <div className="fixed inset-0 z-10" onClick={cancel} />
          <div
            className="absolute right-0 top-full z-20 mt-2 w-[282px] rounded-md border border-light-200 bg-light-50 shadow-lg dark:border-dark-200 dark:bg-dark-100"
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <DateSelectorCalendar
              selectedDate={pendingDueDate}
              rangeStartDate={startDateEnabled ? pendingStartDate : undefined}
              onDateSelect={handleCalendarSelect}
              weekStartsOn={workspace.weekStartDay}
              timeEnabled={pendingHasTime}
              allowDateClear={false}
              className="w-full"
            />
            <div className="space-y-3 px-4 pb-4 text-sm text-light-900 dark:text-dark-900">
              <label className="flex items-center justify-between gap-3">
                <span>{t`Due date`}</span>
                <input
                  aria-label={t`Due date`}
                  type="date"
                  value={
                    pendingDueDate ? format(pendingDueDate, "yyyy-MM-dd") : ""
                  }
                  onChange={(event) => handleDueDateInput(event.target.value)}
                  className="rounded-md border border-light-300 bg-light-50 px-2 py-1 text-sm text-light-1000 dark:border-dark-300 dark:bg-dark-100 dark:text-dark-1000"
                />
              </label>
              {!!pendingDueDate && (
                <DateSelectorTimeControl
                  selectedDate={pendingDueDate}
                  onDateSelect={handleCalendarSelect}
                  timeEnabled={pendingHasTime}
                  onTimeEnabledChange={setPendingHasTime}
                />
              )}
              <div className="space-y-2">
                <label
                  htmlFor={startDateCheckboxId}
                  className="inline-flex items-center gap-2"
                >
                  <input
                    id={startDateCheckboxId}
                    type="checkbox"
                    className="h-[14px] w-[14px] rounded bg-transparent"
                    checked={startDateEnabled}
                    disabled={!pendingDueDate}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      setStartDateEnabled(enabled);
                      setPendingStartDate(null);
                      setRangeAnchor(enabled ? pendingDueDate : null);
                    }}
                  />
                  {t`Start date`}
                </label>
                {startDateEnabled && (
                  <input
                    aria-label={t`Start date`}
                    type="date"
                    value={
                      pendingStartDate
                        ? format(pendingStartDate, "yyyy-MM-dd")
                        : ""
                    }
                    onChange={(event) =>
                      handleStartDateInput(event.target.value)
                    }
                    className="w-full rounded-md border border-light-300 bg-light-50 px-2 py-1 text-sm text-light-1000 dark:border-dark-300 dark:bg-dark-100 dark:text-dark-1000"
                  />
                )}
              </div>
              <label className="flex items-center justify-between gap-3">
                <span>{t`Repeat`}</span>
                <select
                  aria-label={t`Repeat`}
                  value={pendingRecurrenceRule ?? ""}
                  disabled={!pendingDueDate}
                  onChange={(event) =>
                    setPendingRecurrenceRule(
                      (event.target.value === ""
                        ? null
                        : event.target.value) as CardRecurrenceRule | null,
                    )
                  }
                  className="rounded-md border border-light-300 bg-light-50 px-2 py-1 text-sm text-light-1000 dark:border-dark-300 dark:bg-dark-100 dark:text-dark-1000"
                >
                  <option value="">{t`Never`}</option>
                  <option value="daily">{t`Daily`}</option>
                  <option value="weekdays">{t`Weekdays`}</option>
                  <option value="weekly">{t`Weekly`}</option>
                  <option value="monthly">{t`Monthly`}</option>
                </select>
              </label>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-light-200 px-4 py-3 dark:border-dark-200">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={clearDates}
                disabled={!pendingStartDate && !pendingDueDate}
              >
                {t`Clear dates`}
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  onClick={cancel}
                  disabled={updateDates.isPending}
                >
                  {t`Cancel`}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  onClick={save}
                  disabled={!hasChanges || !draftIsValid}
                  isLoading={updateDates.isPending}
                >
                  {t`Save`}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
