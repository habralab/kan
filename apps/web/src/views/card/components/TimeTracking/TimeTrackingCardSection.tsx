import Link from "next/link";
import {
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
  Transition,
} from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { useEffect, useMemo, useRef, useState } from "react";
import { HiCheck, HiChevronDown } from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import type { RouterOutputs } from "~/utils/api";
import type { TimeTrackingPeriod } from "~/utils/timeTracking";
import Button from "~/components/Button";
import LoadingSpinner from "~/components/LoadingSpinner";
import Modal from "~/components/modal";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import {
  formatDuration,
  formatTimerDuration,
  getTimeTrackingPeriodRange,
  TIME_TRACKING_CHANNEL_NAME,
} from "~/utils/timeTracking";
import { TimeEntryForm } from "./TimeEntryForm";

const PAGE_SIZE = 10;
type Worklog = RouterOutputs["timeTracking"]["listWorklogs"]["items"][number];

const getTimezone = () =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const getElapsedSeconds = (startedAt: Date) =>
  Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / 1000));

export function TimeTrackingCardSection({
  cardPublicId,
  boardPublicId,
}: {
  cardPublicId: string;
  boardPublicId: string;
}) {
  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const [entries, setEntries] = useState<Worklog[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [formEntry, setFormEntry] = useState<Worklog | "new" | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<Worklog | null>(null);
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [entriesOpen, setEntriesOpen] = useState(false);
  const [period, setPeriod] = useState<TimeTrackingPeriod>("all");
  const periodRef = useRef(period);
  const periodRange = useMemo(
    () => getTimeTrackingPeriodRange(period),
    [period],
  );
  const periodOptions = [
    { value: "all", label: t`All time` },
    { value: "today", label: t`Today` },
    { value: "yesterday", label: t`Yesterday` },
    { value: "this-week", label: t`This week` },
    { value: "last-week", label: t`Last week` },
    { value: "last-14-days", label: t`Last 14 days` },
    { value: "this-month", label: t`This month` },
    { value: "last-month", label: t`Last month` },
    { value: "this-quarter", label: t`This quarter` },
    { value: "last-quarter", label: t`Last quarter` },
    { value: "this-year", label: t`This year` },
    { value: "last-year", label: t`Last year` },
  ] satisfies { value: TimeTrackingPeriod; label: string }[];
  const selectedPeriod =
    periodOptions.find((option) => option.value === period) ?? periodOptions[0];

  const settings = api.timeTracking.getSettings.useQuery(
    { boardPublicId },
    { enabled: !!boardPublicId },
  );
  const activeTimer = api.timeTracking.getActiveTimer.useQuery();
  const isEnabled = settings.data?.enabled === true;
  const summary = api.timeTracking.getCardSummary.useQuery(
    { cardPublicId, ...(periodRange ?? {}) },
    { enabled: isEnabled },
  );
  const firstPage = api.timeTracking.listWorklogs.useQuery(
    { cardPublicId, limit: PAGE_SIZE, ...(periodRange ?? {}) },
    { enabled: isEnabled && entriesOpen },
  );
  const memberOptions = api.timeTracking.getMemberOptions.useQuery(
    { cardPublicId },
    {
      enabled:
        isEnabled &&
        formEntry !== null &&
        (formEntry === "new" || summary.data?.canManage === true),
    },
  );

  const timer = activeTimer.data;
  const timerIsOnCard =
    timer && !timer.inaccessible && timer.card.publicId === cardPublicId;

  useEffect(() => {
    if (!firstPage.data) return;
    setEntries(firstPage.data.items);
    setNextCursor(firstPage.data.nextCursor);
  }, [firstPage.data, firstPage.dataUpdatedAt]);

  useEffect(() => {
    if (!timer) return;
    const updateElapsed = () =>
      setElapsedSeconds(getElapsedSeconds(timer.startedAt));
    updateElapsed();
    const interval = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(interval);
  }, [timer]);

  useEffect(() => {
    if (!("BroadcastChannel" in window)) return;
    const channel = new BroadcastChannel(TIME_TRACKING_CHANNEL_NAME);
    channel.onmessage = () => {
      void utils.timeTracking.getActiveTimer.invalidate();
      void utils.timeTracking.getBoardCardTotals.invalidate();
      void utils.timeTracking.getCardSummary.invalidate();
      void utils.timeTracking.listWorklogs.invalidate();
      void utils.timeTracking.getReportSummary.invalidate();
      void utils.timeTracking.listReportWorklogs.invalidate();
      void utils.timeTracking.getReportOptions.invalidate();
    };
    return () => channel.close();
  }, [cardPublicId, utils.timeTracking]);

  const broadcastChange = () => {
    if (!("BroadcastChannel" in window)) return;
    const channel = new BroadcastChannel(TIME_TRACKING_CHANNEL_NAME);
    channel.postMessage({ cardPublicId });
    channel.close();
  };

  const refresh = async () => {
    await Promise.all([
      utils.timeTracking.getActiveTimer.invalidate(),
      utils.timeTracking.getBoardCardTotals.invalidate(),
      utils.timeTracking.getCardSummary.invalidate(),
      utils.timeTracking.listWorklogs.invalidate(),
      utils.timeTracking.getReportSummary.invalidate(),
      utils.timeTracking.listReportWorklogs.invalidate(),
      utils.timeTracking.getReportOptions.invalidate(),
    ]);
    broadcastChange();
  };

  const mutationError = (header: string, error: { message: string }) => {
    showPopup({ header, message: error.message, icon: "error" });
  };

  const createWorklog = api.timeTracking.createWorklog.useMutation({
    onSuccess: async () => {
      setFormEntry(null);
      await refresh();
    },
    onError: (error) => mutationError(t`Unable to add time`, error),
  });
  const updateWorklog = api.timeTracking.updateWorklog.useMutation({
    onSuccess: async () => {
      setFormEntry(null);
      await refresh();
    },
    onError: (error) => mutationError(t`Unable to update time entry`, error),
  });
  const removeWorklog = api.timeTracking.deleteWorklog.useMutation({
    onSuccess: async () => {
      setDeleteEntry(null);
      await refresh();
    },
    onError: (error) => mutationError(t`Unable to delete time entry`, error),
  });
  const startTimer = api.timeTracking.startTimer.useMutation({
    onSuccess: async () => {
      setConfirmSwitch(false);
      await refresh();
    },
    onError: (error) => mutationError(t`Unable to start timer`, error),
  });
  const stopTimer = api.timeTracking.stopTimer.useMutation({
    onSuccess: refresh,
    onError: (error) => mutationError(t`Unable to stop timer`, error),
  });
  const discardTimer = api.timeTracking.discardTimer.useMutation({
    onSuccess: refresh,
    onError: (error) => mutationError(t`Unable to discard timer`, error),
  });

  const isMutatingTimer =
    startTimer.isPending || stopTimer.isPending || discardTimer.isPending;

  const memberTotals = useMemo(
    () =>
      summary.data?.memberTotals
        .slice()
        .sort((a, b) => b.durationSeconds - a.durationSeconds) ?? [],
    [summary.data?.memberTotals],
  );

  const effectiveMemberOptions = useMemo(() => {
    if (memberOptions.data) {
      if (
        formEntry &&
        formEntry !== "new" &&
        formEntry.member &&
        !memberOptions.data.members.some(
          (member) => member.publicId === formEntry.member?.publicId,
        )
      ) {
        return {
          ...memberOptions.data,
          members: [...memberOptions.data.members, formEntry.member],
        };
      }
      return memberOptions.data;
    }
    if (formEntry && formEntry !== "new" && formEntry.member) {
      return {
        members: [formEntry.member],
        canManage: false,
        defaultMemberPublicId: formEntry.member.publicId,
      };
    }
    return null;
  }, [formEntry, memberOptions.data]);

  const beginTimer = () => {
    if (timer && !timerIsOnCard) {
      setConfirmSwitch(true);
      return;
    }
    startTimer.mutate({ cardPublicId, timezone: getTimezone() });
  };

  const changePeriod = (nextPeriod: TimeTrackingPeriod) => {
    periodRef.current = nextPeriod;
    setPeriod(nextPeriod);
    setEntries([]);
    setNextCursor(null);
    setDeleteEntry(null);
  };

  const loadMore = async () => {
    if (!nextCursor || isLoadingMore) return;
    const requestedPeriod = periodRef.current;
    setIsLoadingMore(true);
    try {
      const page = await utils.timeTracking.listWorklogs.fetch({
        cardPublicId,
        limit: PAGE_SIZE,
        cursor: nextCursor,
        ...(periodRange ?? {}),
      });
      if (periodRef.current !== requestedPeriod) return;
      setEntries((current) => {
        const existing = new Set(current.map((entry) => entry.publicId));
        return [
          ...current,
          ...page.items.filter((entry) => !existing.has(entry.publicId)),
        ];
      });
      setNextCursor(page.nextCursor);
    } catch (error) {
      mutationError(
        t`Unable to load more time entries`,
        error instanceof Error ? error : new Error(t`Please try again.`),
      );
    } finally {
      setIsLoadingMore(false);
    }
  };

  const activeTimerPanel = timer ? (
    <div className="mb-4 rounded-md border border-light-600 bg-light-100 p-3 dark:border-dark-600 dark:bg-dark-200">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <p className="font-mono text-lg font-semibold text-light-1000 dark:text-dark-1000">
            {formatTimerDuration(elapsedSeconds)}
          </p>
          <p className="truncate text-xs text-light-900 dark:text-dark-900">
            {timer.inaccessible ? (
              t`Timer on an inaccessible card`
            ) : timerIsOnCard ? (
              t`Running on this card`
            ) : (
              <Link
                href={`/cards/${timer.card.publicId}`}
                className="hover:underline"
              >
                {timer.card.title}
              </Link>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="danger"
            onClick={() => stopTimer.mutate({ timezone: getTimezone() })}
            isLoading={stopTimer.isPending ? true : undefined}
            disabled={isMutatingTimer}
          >
            {t`Stop`}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => discardTimer.mutate()}
            isLoading={discardTimer.isPending ? true : undefined}
            disabled={isMutatingTimer}
          >
            {t`Discard`}
          </Button>
        </div>
      </div>
    </div>
  ) : null;

  if (settings.isLoading || activeTimer.isLoading) {
    return (
      <div className="mb-8 flex h-10 items-center text-light-900 dark:text-dark-900">
        <LoadingSpinner size="sm" />
      </div>
    );
  }

  if (activeTimer.isError) {
    return (
      <div className="mb-8 space-y-3 border-t border-light-300 pt-6 dark:border-dark-300">
        <p role="alert" className="text-sm text-red-700 dark:text-red-500">
          {t`Unable to load the active timer.`}
        </p>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void activeTimer.refetch()}
        >
          {t`Try again`}
        </Button>
      </div>
    );
  }

  if (settings.isError) {
    return (
      <div className="mb-8 space-y-3 border-t border-light-300 pt-6 dark:border-dark-300">
        {activeTimerPanel}
        <p role="alert" className="text-sm text-red-700 dark:text-red-500">
          {t`Unable to load time tracking.`}
        </p>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => settings.refetch()}
        >
          {t`Try again`}
        </Button>
      </div>
    );
  }

  if (!isEnabled) return activeTimerPanel;

  return (
    <section className="mb-10 border-t border-light-300 pt-6 dark:border-dark-300">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-medium text-light-1000 dark:text-dark-1000">
            {t`Time tracking`}
          </h2>
          <p className="mt-1 text-2xl font-semibold text-light-1000 dark:text-dark-1000">
            {summary.isLoading
              ? "…"
              : formatDuration(summary.data?.totalSeconds ?? 0)}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Listbox value={period} onChange={changePeriod}>
            <div className="relative">
              <ListboxButton
                aria-label={t`Period`}
                className="relative inline-flex min-w-36 cursor-pointer items-center rounded-md border border-light-600 bg-light-50 py-2 pl-3 pr-8 text-left text-xs font-semibold text-light-1000 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-400 dark:border-dark-600 dark:bg-dark-300 dark:text-dark-1000 dark:focus-visible:ring-dark-500"
              >
                <span className="block max-w-32 truncate">
                  {selectedPeriod?.label}
                </span>
                <HiChevronDown
                  aria-hidden
                  className="pointer-events-none absolute right-2 h-4 w-4 text-light-700 dark:text-dark-700"
                />
              </ListboxButton>
              <Transition
                leave="transition ease-in duration-100"
                leaveFrom="opacity-100"
                leaveTo="opacity-0"
              >
                <ListboxOptions className="absolute right-0 z-50 mt-1 max-h-72 w-52 overflow-y-auto rounded-md border border-light-300 bg-light-50 py-1 text-sm shadow-lg focus:outline-none dark:border-dark-400 dark:bg-dark-200">
                  {periodOptions.map((option) => (
                    <ListboxOption
                      key={option.value}
                      value={option.value}
                      className={({ focus, selected }) =>
                        twMerge(
                          "relative cursor-pointer select-none py-2 pl-3 pr-9 text-light-900 dark:text-dark-900",
                          focus &&
                            "bg-light-200 text-light-1000 dark:bg-dark-400 dark:text-dark-1000",
                          selected &&
                            "font-semibold text-light-1000 dark:text-dark-1000",
                        )
                      }
                    >
                      {({ selected }) => (
                        <>
                          <span className="block truncate">{option.label}</span>
                          {selected && (
                            <HiCheck
                              aria-hidden
                              className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2"
                            />
                          )}
                        </>
                      )}
                    </ListboxOption>
                  ))}
                </ListboxOptions>
              </Transition>
            </div>
          </Listbox>
          {summary.data?.canCreate && (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setFormEntry("new")}
              >
                {t`Add time`}
              </Button>
              {!timerIsOnCard && summary.data.canStartTimer && (
                <Button
                  size="sm"
                  onClick={beginTimer}
                  isLoading={startTimer.isPending}
                >
                  {t`Start timer`}
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {activeTimerPanel}

      {confirmSwitch && timer && (
        <div className="mb-4 rounded-md border border-amber-500 bg-amber-50 p-3 text-sm dark:bg-dark-200">
          <p className="text-light-1000 dark:text-dark-1000">
            {timer.inaccessible
              ? t`Starting this timer will stop the timer on the inaccessible card and save its elapsed time.`
              : t`Starting this timer will stop the timer on “${timer.card.title}” and save its elapsed time.`}
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setConfirmSwitch(false)}
            >
              {t`Cancel`}
            </Button>
            <Button
              size="sm"
              onClick={() =>
                startTimer.mutate({ cardPublicId, timezone: getTimezone() })
              }
              isLoading={startTimer.isPending}
            >
              {t`Stop and start`}
            </Button>
          </div>
        </div>
      )}

      <Modal
        modalSize="sm"
        isVisible={formEntry !== null}
        closeOnClickOutside={false}
      >
        {effectiveMemberOptions && formEntry ? (
          <TimeEntryForm
            entry={formEntry === "new" ? undefined : formEntry}
            memberOptions={effectiveMemberOptions}
            isSaving={createWorklog.isPending || updateWorklog.isPending}
            onCancel={() => setFormEntry(null)}
            onSave={(values) => {
              if (formEntry === "new") {
                createWorklog.mutate({ cardPublicId, ...values });
              } else {
                updateWorklog.mutate({
                  worklogPublicId: formEntry.publicId,
                  ...values,
                });
              }
            }}
          />
        ) : memberOptions.isError ? (
          <div className="space-y-4 p-5">
            <p className="text-sm text-red-700 dark:text-red-500">
              {t`Unable to load members.`}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setFormEntry(null)}
              >
                {t`Cancel`}
              </Button>
              <Button size="sm" onClick={() => memberOptions.refetch()}>
                {t`Try again`}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex min-h-32 items-center justify-center p-5">
            <LoadingSpinner />
          </div>
        )}
      </Modal>

      {memberTotals.length > 0 && (
        <div className="mb-5 mt-4 flex flex-wrap gap-2">
          {memberTotals.map(({ member, durationSeconds }, index) => (
            <span
              key={member?.publicId ?? `unavailable-${index}`}
              className="rounded-full bg-light-200 px-2.5 py-1 text-xs text-light-900 dark:bg-dark-300 dark:text-dark-900"
            >
              {member?.displayName ?? t`Unavailable member`}:{" "}
              {formatDuration(durationSeconds)}
            </span>
          ))}
        </div>
      )}

      {summary.isError && (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-red-700 dark:text-red-500">
            {t`Unable to load time entries.`}
          </p>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void summary.refetch()}
          >
            {t`Try again`}
          </Button>
        </div>
      )}

      {(summary.data?.entryCount ?? 0) > 0 && (
        <Disclosure
          as="div"
          className="mt-4 border-t border-light-300 pt-2 dark:border-dark-300"
        >
          {({ open }) => (
            <>
              <DisclosureButton
                className="group flex w-full items-center justify-between rounded-md py-2 text-left text-sm font-medium text-light-1000 focus-visible:outline-none dark:text-dark-1000"
                onClick={() => setEntriesOpen(!open)}
              >
                <span>
                  {t`Time entries`} · {summary.data?.entryCount}
                </span>
                <HiChevronDown className="h-4 w-4 text-light-900 transition-transform group-data-[open]:rotate-180 dark:text-dark-900" />
              </DisclosureButton>
              <DisclosurePanel className="space-y-3 pt-2">
                {firstPage.isError ? (
                  <div className="space-y-3">
                    <p className="text-sm text-red-700 dark:text-red-500">
                      {t`Unable to load time entries.`}
                    </p>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        void firstPage.refetch();
                      }}
                    >
                      {t`Try again`}
                    </Button>
                  </div>
                ) : firstPage.isLoading ? (
                  <LoadingSpinner size="sm" />
                ) : entries.length === 0 ? (
                  <p className="text-sm text-light-900 dark:text-dark-900">
                    {t`No time has been logged on this card yet.`}
                  </p>
                ) : (
                  entries.map((entry) => (
                    <div
                      key={entry.publicId}
                      className="rounded-md border border-light-300 px-3 py-2 dark:border-dark-300"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-light-1000 dark:text-dark-1000">
                            <span className="font-medium">
                              {entry.member?.displayName ??
                                t`Unavailable member`}
                            </span>
                            {" · "}
                            {formatDuration(entry.durationSeconds)}
                            {" · "}
                            {entry.workDate}
                          </p>
                          {entry.comment && (
                            <p className="mt-1 whitespace-pre-wrap text-xs text-light-900 dark:text-dark-900">
                              {entry.comment}
                            </p>
                          )}
                        </div>
                        {(entry.canEdit || entry.canDelete) && (
                          <div className="flex shrink-0 gap-1">
                            {entry.canEdit && (
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => setFormEntry(entry)}
                              >
                                {t`Edit`}
                              </Button>
                            )}
                            {entry.canDelete && (
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => setDeleteEntry(entry)}
                              >
                                {t`Delete`}
                              </Button>
                            )}
                          </div>
                        )}
                      </div>
                      {deleteEntry?.publicId === entry.publicId && (
                        <div className="mt-3 flex items-center justify-end gap-2 border-t border-light-300 pt-2 dark:border-dark-300">
                          <span className="mr-auto text-xs text-light-900 dark:text-dark-900">
                            {t`Delete this time entry?`}
                          </span>
                          <Button
                            size="xs"
                            variant="secondary"
                            onClick={() => setDeleteEntry(null)}
                          >
                            {t`Cancel`}
                          </Button>
                          <Button
                            size="xs"
                            variant="danger"
                            onClick={() =>
                              removeWorklog.mutate({
                                worklogPublicId: entry.publicId,
                              })
                            }
                            isLoading={removeWorklog.isPending}
                          >
                            {t`Delete`}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))
                )}

                {nextCursor && (
                  <div className="flex justify-center pt-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={loadMore}
                      isLoading={isLoadingMore}
                    >
                      {t`Load more`}
                    </Button>
                  </div>
                )}
              </DisclosurePanel>
            </>
          )}
        </Disclosure>
      )}
    </section>
  );
}
