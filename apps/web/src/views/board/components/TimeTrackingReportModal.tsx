import Link from "next/link";
import { Dialog, Transition } from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { Fragment, useEffect, useState } from "react";
import { HiXMark } from "react-icons/hi2";

import type { RouterOutputs } from "~/utils/api";
import Button from "~/components/Button";
import LoadingSpinner from "~/components/LoadingSpinner";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import {
  formatDuration,
  TIME_TRACKING_CHANNEL_NAME,
} from "~/utils/timeTracking";

const PAGE_SIZE = 50;

type ReportWorklog =
  RouterOutputs["timeTracking"]["listReportWorklogs"]["items"][number];

const localDate = (date: Date) => {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

const currentMonthRange = () => {
  const now = new Date();
  return {
    fromDate: localDate(new Date(now.getFullYear(), now.getMonth(), 1)),
    toDate: localDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
};

const previousMonthRange = () => {
  const now = new Date();
  return {
    fromDate: localDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
    toDate: localDate(new Date(now.getFullYear(), now.getMonth(), 0)),
  };
};

const lastThirtyDaysRange = () => {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 29);
  return { fromDate: localDate(from), toDate: localDate(to) };
};

export function TimeTrackingReportModal({
  boardPublicId,
}: {
  boardPublicId: string;
}) {
  const { closeModal } = useModal();
  const { showPopup } = usePopup();
  const utils = api.useUtils();
  const initialRange = currentMonthRange();
  const [fromDate, setFromDate] = useState(initialRange.fromDate);
  const [toDate, setToDate] = useState(initialRange.toDate);
  const [workspaceMemberPublicId, setWorkspaceMemberPublicId] = useState("");
  const [cardPublicId, setCardPublicId] = useState("");
  const [listPublicId, setListPublicId] = useState("");
  const [labelPublicId, setLabelPublicId] = useState("");
  const [groupBy, setGroupBy] = useState<"member" | "card" | "list" | "">("");
  const [entries, setEntries] = useState<ReportWorklog[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const filters = {
    boardPublicId,
    dateFrom: fromDate,
    dateTo: toDate,
    memberPublicIds: workspaceMemberPublicId
      ? [workspaceMemberPublicId]
      : undefined,
    cardPublicIds: cardPublicId ? [cardPublicId] : undefined,
    listPublicIds: listPublicId ? [listPublicId] : undefined,
    labelPublicIds: labelPublicId ? [labelPublicId] : undefined,
  };
  const validRange = fromDate <= toDate;
  const options = api.timeTracking.getReportOptions.useQuery({ boardPublicId });
  const summary = api.timeTracking.getReportSummary.useQuery(
    { ...filters, groupBy: groupBy === "" ? undefined : groupBy },
    { enabled: validRange },
  );
  const firstPage = api.timeTracking.listReportWorklogs.useQuery(
    { ...filters, limit: PAGE_SIZE },
    { enabled: validRange },
  );

  useEffect(() => {
    if (!firstPage.data) return;
    setEntries(firstPage.data.items);
    setNextCursor(firstPage.data.nextCursor);
  }, [firstPage.data, firstPage.dataUpdatedAt]);

  useEffect(() => {
    if (!("BroadcastChannel" in window)) return;
    const channel = new BroadcastChannel(TIME_TRACKING_CHANNEL_NAME);
    channel.onmessage = () => {
      void utils.timeTracking.getReportOptions.invalidate();
      void utils.timeTracking.getReportSummary.invalidate();
      void utils.timeTracking.listReportWorklogs.invalidate();
    };
    return () => channel.close();
  }, [utils.timeTracking]);

  const loadMore = async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const page = await utils.timeTracking.listReportWorklogs.fetch({
        ...filters,
        limit: PAGE_SIZE,
        cursor: nextCursor,
      });
      setEntries((current) => {
        const existing = new Set(current.map((entry) => entry.publicId));
        return [
          ...current,
          ...page.items.filter((entry) => !existing.has(entry.publicId)),
        ];
      });
      setNextCursor(page.nextCursor);
    } catch (error) {
      showPopup({
        header: t`Unable to load more time entries`,
        message: error instanceof Error ? error.message : t`Please try again.`,
        icon: "error",
      });
    } finally {
      setIsLoadingMore(false);
    }
  };

  const setRange = (range: { fromDate: string; toDate: string }) => {
    setFromDate(range.fromDate);
    setToDate(range.toDate);
  };

  const exportUrl = (profile: "summary" | "detailed") => {
    const params = new URLSearchParams({
      boardPublicId,
      dateFrom: fromDate,
      dateTo: toDate,
      profile,
    });
    if (workspaceMemberPublicId)
      params.append("memberPublicIds", workspaceMemberPublicId);
    if (cardPublicId) params.append("cardPublicIds", cardPublicId);
    if (listPublicId) params.append("listPublicIds", listPublicId);
    if (labelPublicId) params.append("labelPublicIds", labelPublicId);
    if (profile === "summary" && groupBy) params.set("groupBy", groupBy);
    return `/api/time-tracking/export?${params.toString()}`;
  };

  const inputClassName =
    "mt-1 block w-full rounded-md border border-light-600 bg-light-50 px-3 py-2 text-sm text-light-1000 focus:border-light-1000 focus:outline-none dark:border-dark-600 dark:bg-dark-200 dark:text-dark-1000";
  const hasError = options.isError || summary.isError || firstPage.isError;

  return (
    <Transition.Root show as={Fragment}>
      <Dialog as="div" className="relative z-50" onClose={closeModal}>
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-light-50/60 backdrop-blur-sm dark:bg-dark-50/60" />
        </Transition.Child>

        <div className="fixed inset-0 overflow-hidden p-2 md:p-6">
          <Dialog.Panel className="mx-auto flex h-full max-w-[1400px] flex-col overflow-hidden rounded-lg border border-light-600 bg-light-50 shadow-3xl-light dark:border-dark-600 dark:bg-dark-100 dark:shadow-3xl-dark">
            <div className="flex items-center justify-between border-b border-light-300 px-5 py-4 dark:border-dark-300">
              <Dialog.Title className="text-base font-bold text-light-1000 dark:text-dark-1000">
                {t`Time report`}
              </Dialog.Title>
              <button
                type="button"
                className="rounded p-1 hover:bg-light-200 dark:hover:bg-dark-300"
                onClick={closeModal}
                aria-label={t`Close`}
              >
                <HiXMark className="h-5 w-5 text-light-900 dark:text-dark-900" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              <div className="mb-4 flex flex-wrap gap-2">
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => setRange(currentMonthRange())}
                >
                  {t`Current month`}
                </Button>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => setRange(previousMonthRange())}
                >
                  {t`Previous month`}
                </Button>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => setRange(lastThirtyDaysRange())}
                >
                  {t`Last 30 days`}
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <label className="text-xs text-light-900 dark:text-dark-900">
                  {t`From`}
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(event) => setFromDate(event.target.value)}
                    className={inputClassName}
                  />
                </label>
                <label className="text-xs text-light-900 dark:text-dark-900">
                  {t`To`}
                  <input
                    type="date"
                    value={toDate}
                    onChange={(event) => setToDate(event.target.value)}
                    className={inputClassName}
                  />
                </label>
                <label className="text-xs text-light-900 dark:text-dark-900">
                  {t`Member`}
                  <select
                    value={workspaceMemberPublicId}
                    onChange={(event) =>
                      setWorkspaceMemberPublicId(event.target.value)
                    }
                    className={inputClassName}
                  >
                    <option value="">{t`All members`}</option>
                    {options.data?.members.map((member) => (
                      <option key={member.publicId} value={member.publicId}>
                        {member.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-light-900 dark:text-dark-900">
                  {t`List`}
                  <select
                    value={listPublicId}
                    onChange={(event) => {
                      setListPublicId(event.target.value);
                      setCardPublicId("");
                    }}
                    className={inputClassName}
                  >
                    <option value="">{t`All lists`}</option>
                    {options.data?.lists.map((list) => (
                      <option key={list.publicId} value={list.publicId}>
                        {list.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-light-900 dark:text-dark-900">
                  {t`Card`}
                  <select
                    value={cardPublicId}
                    onChange={(event) => setCardPublicId(event.target.value)}
                    className={inputClassName}
                  >
                    <option value="">{t`All cards`}</option>
                    {options.data?.cards
                      .filter(
                        (card) =>
                          !listPublicId || card.listPublicId === listPublicId,
                      )
                      .map((card) => (
                        <option key={card.publicId} value={card.publicId}>
                          {card.title}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="text-xs text-light-900 dark:text-dark-900">
                  {t`Label`}
                  <select
                    value={labelPublicId}
                    onChange={(event) => setLabelPublicId(event.target.value)}
                    className={inputClassName}
                  >
                    <option value="">{t`All labels`}</option>
                    {options.data?.labels.map((label) => (
                      <option key={label.publicId} value={label.publicId}>
                        {label.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {!validRange && (
                <p className="mt-3 text-sm text-red-700 dark:text-red-500">
                  {t`The start date must not be after the end date.`}
                </p>
              )}

              <div className="my-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  [
                    t`Total time`,
                    formatDuration(summary.data?.totalSeconds ?? 0),
                  ],
                  [t`Entries`, summary.data?.entryCount ?? 0],
                  [t`Members`, summary.data?.memberCount ?? 0],
                  [t`Cards`, summary.data?.cardCount ?? 0],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-md border border-light-300 p-4 dark:border-dark-300"
                  >
                    <p className="text-xs text-light-900 dark:text-dark-900">
                      {label}
                    </p>
                    <p className="mt-1 text-xl font-semibold text-light-1000 dark:text-dark-1000">
                      {summary.isLoading ? "…" : value}
                    </p>
                  </div>
                ))}
              </div>

              <div className="mb-6">
                <label className="block max-w-64 text-xs text-light-900 dark:text-dark-900">
                  {t`Group by`}
                  <select
                    value={groupBy}
                    onChange={(event) =>
                      setGroupBy(
                        event.target.value as "member" | "card" | "list" | "",
                      )
                    }
                    className={inputClassName}
                  >
                    <option value="">{t`No grouping`}</option>
                    <option value="member">{t`Member`}</option>
                    <option value="card">{t`Card`}</option>
                    <option value="list">{t`List`}</option>
                  </select>
                </label>

                {groupBy && summary.data && summary.data.groups.length > 0 && (
                  <div className="mt-3 overflow-hidden rounded-md border border-light-300 dark:border-dark-300">
                    {summary.data.groups.map((group) => (
                      <div
                        key={group.publicId}
                        className="flex items-center justify-between gap-4 border-b border-light-300 px-3 py-2 last:border-b-0 dark:border-dark-300"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-light-1000 dark:text-dark-1000">
                            {group.label}
                          </p>
                          <p className="text-xs text-light-900 dark:text-dark-900">
                            {t`${group.entryCount} entries`}
                          </p>
                        </div>
                        <span className="whitespace-nowrap text-sm font-semibold text-light-1000 dark:text-dark-1000">
                          {formatDuration(group.durationSeconds)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-medium text-light-1000 dark:text-dark-1000">
                  {t`Time entries`}
                </h3>
                <div className="flex gap-2">
                  <Button
                    href={
                      validRange && groupBy ? exportUrl("summary") : undefined
                    }
                    openInNewTab
                    size="xs"
                    variant="secondary"
                    disabled={!validRange || !groupBy}
                    title={
                      groupBy
                        ? undefined
                        : t`Choose a grouping to export a summary`
                    }
                  >
                    {t`Export summary CSV`}
                  </Button>
                  <Button
                    href={validRange ? exportUrl("detailed") : undefined}
                    openInNewTab
                    size="xs"
                    variant="secondary"
                    disabled={!validRange}
                  >
                    {t`Export detailed CSV`}
                  </Button>
                </div>
              </div>

              {hasError ? (
                <div className="space-y-3 rounded-md border border-red-500 p-4">
                  <p className="text-sm text-red-700 dark:text-red-500">
                    {t`Unable to load the time report.`}
                  </p>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      void options.refetch();
                      void summary.refetch();
                      void firstPage.refetch();
                    }}
                  >
                    {t`Try again`}
                  </Button>
                </div>
              ) : firstPage.isLoading ? (
                <div className="flex min-h-40 items-center justify-center">
                  <LoadingSpinner />
                </div>
              ) : entries.length === 0 ? (
                <p className="rounded-md border border-light-300 p-6 text-center text-sm text-light-900 dark:border-dark-300 dark:text-dark-900">
                  {t`No time entries match these filters.`}
                </p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-light-300 dark:border-dark-300">
                  <table className="w-full min-w-[1000px] text-left text-sm">
                    <thead className="bg-light-200 text-xs text-light-900 dark:bg-dark-200 dark:text-dark-900">
                      <tr>
                        <th className="px-3 py-2 font-medium">{t`Date`}</th>
                        <th className="px-3 py-2 font-medium">{t`Member`}</th>
                        <th className="px-3 py-2 font-medium">{t`Card`}</th>
                        <th className="px-3 py-2 font-medium">{t`List`}</th>
                        <th className="px-3 py-2 font-medium">{t`Labels`}</th>
                        <th className="px-3 py-2 font-medium">{t`Method`}</th>
                        <th className="px-3 py-2 text-right font-medium">
                          {t`Time`}
                        </th>
                        <th className="px-3 py-2 font-medium">{t`Comment`}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-light-300 dark:divide-dark-300">
                      {entries.map((entry) => (
                        <tr key={entry.publicId}>
                          <td className="whitespace-nowrap px-3 py-2">
                            {entry.workDate}
                          </td>
                          <td className="px-3 py-2">
                            {entry.member.displayName}
                          </td>
                          <td className="max-w-64 truncate px-3 py-2">
                            <Link
                              href={`/cards/${entry.card.publicId}`}
                              className="hover:underline"
                              onClick={closeModal}
                            >
                              {entry.card.title}
                            </Link>
                          </td>
                          <td className="px-3 py-2">{entry.card.list.name}</td>
                          <td className="max-w-48 truncate px-3 py-2">
                            {entry.labels.length > 0
                              ? entry.labels
                                  .map((label) => label.name)
                                  .join(", ")
                              : "—"}
                          </td>
                          <td className="px-3 py-2">
                            {entry.entryMethod === "timer"
                              ? t`Timer`
                              : t`Manual`}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right font-medium">
                            {formatDuration(entry.durationSeconds)}
                          </td>
                          <td className="max-w-72 truncate px-3 py-2">
                            {entry.comment ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {nextCursor && !hasError && (
                <div className="mt-4 flex justify-center">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={loadMore}
                    isLoading={isLoadingMore}
                  >
                    {t`Load more`}
                  </Button>
                </div>
              )}
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </Transition.Root>
  );
}
