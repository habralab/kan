import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { useState } from "react";
import {
  HiCheck,
  HiMagnifyingGlass,
  HiOutlineUserCircle,
} from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import { formatMemberDisplayName } from "~/utils/helpers";

export interface ChecklistAssignee {
  publicId: string;
  email: string;
  status: "active" | "invited" | "removed" | "paused";
  user: { name: string | null } | null;
}

interface ChecklistItemAssigneeProps {
  assignee: ChecklistAssignee | null;
  workspaceMembers: ChecklistAssignee[];
  viewOnly: boolean;
  onSelect: (memberPublicId: string | null) => void;
  align?: "left" | "right";
}

export function ChecklistItemAssignee({
  assignee,
  workspaceMembers,
  viewOnly,
  onSelect,
  align = "left",
}: ChecklistItemAssigneeProps) {
  const [query, setQuery] = useState("");
  const inactiveLabel =
    assignee?.status === "paused"
      ? t`Paused`
      : assignee?.status === "removed"
        ? t`Removed`
        : null;
  const displayName = assignee
    ? formatMemberDisplayName(assignee.user?.name ?? null, assignee.email)
    : null;
  const selectableMembers = workspaceMembers.filter(
    (member) => member.status === "active" || member.status === "invited",
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingMembers = selectableMembers.filter((member) => {
    const memberName = formatMemberDisplayName(
      member.user?.name ?? null,
      member.email,
    );

    return (
      memberName.toLocaleLowerCase().includes(normalizedQuery) ||
      member.email.toLocaleLowerCase().includes(normalizedQuery)
    );
  });

  if (viewOnly) {
    if (!assignee) return null;
    return (
      <span className="inline-flex items-center gap-1 text-xs text-light-700 dark:text-dark-700">
        <HiOutlineUserCircle size={14} />
        {displayName}
        {inactiveLabel && ` (${inactiveLabel})`}
      </span>
    );
  }

  return (
    <div className="inline-flex min-w-0 max-w-full items-center gap-1 text-xs text-light-700 dark:text-dark-700">
      <Popover className="relative">
        {({ close }) => (
          <>
            <PopoverButton
              aria-label={t`Checklist item assignee`}
              onClick={() => setQuery("")}
              className={twMerge(
                "inline-flex min-w-0 max-w-full items-center gap-1 rounded-sm p-0.5 text-light-700 hover:bg-light-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-light-700 dark:text-dark-700 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-700",
                inactiveLabel && "opacity-50",
              )}
            >
              <HiOutlineUserCircle
                size={16}
                aria-hidden="true"
                className="shrink-0"
              />
              {assignee && (
                <span className="min-w-0 truncate">
                  {displayName}
                  {inactiveLabel && ` (${inactiveLabel})`}
                </span>
              )}
            </PopoverButton>
            <PopoverPanel
              className={twMerge(
                "absolute z-50 mt-1 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-light-200 bg-white py-1 text-sm shadow-lg ring-1 ring-black/5 focus:outline-none dark:border-dark-400 dark:bg-dark-200",
                align === "right" ? "right-0" : "left-0",
              )}
            >
              <div className="relative border-b border-light-200 px-2 py-1.5 dark:border-dark-400">
                <input
                  autoFocus
                  aria-label={t`Search members`}
                  type="search"
                  className="w-full rounded-md border-0 bg-light-100 py-1.5 pl-8 pr-2 text-sm text-light-1000 placeholder:text-light-700 focus:outline-none focus:ring-2 focus:ring-light-700 dark:bg-dark-300 dark:text-dark-1000 dark:placeholder:text-dark-700 dark:focus:ring-dark-700"
                  placeholder={t`Search members`}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <HiMagnifyingGlass
                  aria-hidden="true"
                  className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-light-700 dark:text-dark-700"
                />
              </div>
              <div className="max-h-60 overflow-y-auto py-1">
                {assignee && (
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(null);
                      close();
                    }}
                    className="flex w-full items-center px-3 py-2 text-left text-light-900 hover:bg-light-200 focus:bg-light-200 focus:outline-none dark:text-dark-900 dark:hover:bg-dark-400 dark:focus:bg-dark-400"
                  >
                    {t`Unassign`}
                  </button>
                )}
                {matchingMembers.map((member) => (
                  <button
                    key={member.publicId}
                    type="button"
                    onClick={() => {
                      onSelect(member.publicId);
                      close();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-light-900 hover:bg-light-200 focus:bg-light-200 focus:outline-none dark:text-dark-900 dark:hover:bg-dark-400 dark:focus:bg-dark-400"
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {formatMemberDisplayName(
                        member.user?.name ?? null,
                        member.email,
                      )}
                      <span className="text-light-700 dark:text-dark-700">
                        {` (${member.email})`}
                      </span>
                    </span>
                    {member.publicId === assignee?.publicId && (
                      <HiCheck
                        aria-hidden="true"
                        className="h-4 w-4 shrink-0"
                      />
                    )}
                  </button>
                ))}
                {matchingMembers.length === 0 && (
                  <p className="px-3 py-2 text-light-700 dark:text-dark-700">
                    {normalizedQuery
                      ? t`No members found.`
                      : t`No members available.`}
                  </p>
                )}
              </div>
            </PopoverPanel>
          </>
        )}
      </Popover>
    </div>
  );
}
