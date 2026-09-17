import { t } from "@lingui/core/macro";
import { format, parseISO, startOfDay } from "date-fns";
import { useEffect, useId, useState } from "react";
import { HiMiniPlus } from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import Button from "~/components/Button";
import DateSelector from "~/components/DateSelector";
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

  useEffect(() => {
    if (isOpen) return;
    setPendingStartDate(startDate ?? null);
    setPendingDueDate(dueDate ?? null);
    setPendingHasTime(dueDateHasTime);
    setStartDateEnabled(!!startDate);
    setRangeAnchor(null);
  }, [dueDate, dueDateHasTime, isOpen, startDate]);

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
    onSuccess: () => setIsOpen(false),
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
    });
  };

  const hasChanges =
    !datesMatch(pendingStartDate, startDate) ||
    !datesMatch(pendingDueDate, dueDate) ||
    (!!pendingDueDate && pendingHasTime !== dueDateHasTime);
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
            <div className="space-y-3 px-4 pt-4 text-sm text-light-900 dark:text-dark-900">
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
              <div className="space-y-2">
                <label
                  htmlFor={startDateCheckboxId}
                  className="flex items-center gap-2"
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
            </div>
            <DateSelector
              selectedDate={pendingDueDate}
              rangeStartDate={startDateEnabled ? pendingStartDate : undefined}
              onDateSelect={handleCalendarSelect}
              weekStartsOn={workspace.weekStartDay}
              showTime={!!pendingDueDate}
              timeEnabled={pendingHasTime}
              onTimeEnabledChange={setPendingHasTime}
              allowDateClear={false}
              className="w-full"
            />
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
