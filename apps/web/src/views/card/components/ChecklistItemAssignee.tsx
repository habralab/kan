import { t } from "@lingui/core/macro";
import { HiOutlineUserCircle } from "react-icons/hi2";

import Dropdown from "~/components/Dropdown";
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
}

export function ChecklistItemAssignee({
  assignee,
  workspaceMembers,
  viewOnly,
  onSelect,
}: ChecklistItemAssigneeProps) {
  const inactiveLabel =
    assignee?.status === "paused"
      ? t`Paused`
      : assignee?.status === "removed"
        ? t`Removed`
        : null;
  const displayName = assignee
    ? formatMemberDisplayName(assignee.user?.name ?? null, assignee.email)
    : null;

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
    <div className="inline-flex items-center gap-1 text-xs text-light-700 dark:text-dark-700">
      <Dropdown
        ariaLabel={t`Checklist item assignee`}
        items={[
          ...(assignee
            ? [{ label: t`Unassign`, action: () => onSelect(null) }]
            : []),
          ...workspaceMembers
            .filter(
              (member) =>
                member.status === "active" || member.status === "invited",
            )
            .filter((member) => member.publicId !== assignee?.publicId)
            .map((member) => ({
              label: `${formatMemberDisplayName(member.user?.name ?? null, member.email)} (${member.email})`,
              action: () => onSelect(member.publicId),
            })),
        ]}
      >
        <HiOutlineUserCircle size={16} />
      </Dropdown>
      {assignee && (
        <span className={inactiveLabel ? "opacity-50" : undefined}>
          {displayName}
          {inactiveLabel && ` (${inactiveLabel})`}
        </span>
      )}
    </div>
  );
}
