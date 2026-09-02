import { t } from "@lingui/core/macro";
import { useId, useState } from "react";

import type { RouterOutputs } from "~/utils/api";
import Button from "~/components/Button";
import { parseDurationToSeconds } from "~/utils/timeTracking";

type MemberOptions = RouterOutputs["timeTracking"]["getMemberOptions"];
type Worklog = RouterOutputs["timeTracking"]["listWorklogs"]["items"][number];

interface TimeEntryFormProps {
  entry?: Worklog;
  memberOptions: MemberOptions;
  isSaving: boolean;
  onCancel: () => void;
  onSave: (values: {
    workspaceMemberPublicId?: string;
    workDate: string;
    durationSeconds: number;
    comment: string | null;
  }) => void;
}

const today = () => {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};

const durationValue = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (minutes === 0) return `${hours}h`;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
};

const memberStatusLabel = (
  status: MemberOptions["members"][number]["status"],
) => {
  if (status === "paused") return t`Paused`;
  if (status === "removed") return t`Removed`;
  if (status === "invited") return t`Invited`;
  return t`Active`;
};

export function TimeEntryForm({
  entry,
  memberOptions,
  isSaving,
  onCancel,
  onSave,
}: TimeEntryFormProps) {
  const [memberPublicId, setMemberPublicId] = useState(
    entry ? entry.member.publicId : memberOptions.defaultMemberPublicId,
  );
  const [duration, setDuration] = useState(
    entry ? durationValue(entry.durationSeconds) : "",
  );
  const [workDate, setWorkDate] = useState(entry?.workDate ?? today());
  const [comment, setComment] = useState(entry?.comment ?? "");
  const [durationError, setDurationError] = useState(false);
  const fieldId = useId();
  const durationErrorId = `${fieldId}-duration-error`;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const durationSeconds = parseDurationToSeconds(duration);
    if (!durationSeconds) {
      setDurationError(true);
      return;
    }

    onSave({
      workspaceMemberPublicId:
        memberOptions.canManage &&
        memberPublicId &&
        memberPublicId !== entry?.member.publicId
          ? memberPublicId
          : entry
            ? undefined
            : memberOptions.defaultMemberPublicId,
      workDate,
      durationSeconds,
      comment: comment.trim() || null,
    });
  };

  const inputClassName =
    "mt-1 block w-full rounded-md border border-light-600 bg-light-50 px-3 py-2 text-sm text-light-1000 focus:border-light-1000 focus:outline-none dark:border-dark-600 dark:bg-dark-200 dark:text-dark-1000";

  return (
    <form onSubmit={submit} className="space-y-4 p-5" aria-busy={isSaving}>
      <h3 className="text-sm font-medium text-light-1000 dark:text-dark-1000">
        {entry ? t`Edit time entry` : t`Add time`}
      </h3>

      {memberOptions.canManage && (
        <label className="block text-xs text-light-900 dark:text-dark-900">
          {t`Member`}
          <select
            id={`${fieldId}-member`}
            value={memberPublicId}
            onChange={(event) => setMemberPublicId(event.target.value)}
            className={inputClassName}
            required
          >
            <option value="">{t`Select a member`}</option>
            {memberOptions.members.map((member) => (
              <option key={member.publicId} value={member.publicId}>
                {member.displayName}
                {member.status !== "active"
                  ? ` (${memberStatusLabel(member.status)})`
                  : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-xs text-light-900 dark:text-dark-900">
          {t`Time`}
          <input
            id={`${fieldId}-duration`}
            value={duration}
            onChange={(event) => {
              setDuration(event.target.value);
              setDurationError(false);
            }}
            className={inputClassName}
            placeholder={t`1h 30m`}
            required
            aria-invalid={durationError}
            aria-describedby={durationError ? durationErrorId : undefined}
          />
          {durationError && (
            <span
              id={durationErrorId}
              role="alert"
              className="mt-1 block text-red-700 dark:text-red-500"
            >
              {t`Enter a duration such as 2h, 90m, or 1:30.`}
            </span>
          )}
        </label>
        <label className="block text-xs text-light-900 dark:text-dark-900">
          {t`Date`}
          <input
            id={`${fieldId}-date`}
            type="date"
            value={workDate}
            onChange={(event) => setWorkDate(event.target.value)}
            className={inputClassName}
            required
          />
        </label>
      </div>

      <label className="block text-xs text-light-900 dark:text-dark-900">
        {t`Comment`}
        <textarea
          id={`${fieldId}-comment`}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          className={inputClassName}
          rows={2}
          maxLength={10_000}
        />
      </label>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          {t`Cancel`}
        </Button>
        <Button
          type="submit"
          size="sm"
          isLoading={isSaving ? true : undefined}
          disabled={isSaving || (memberOptions.canManage && !memberPublicId)}
        >
          {t`Save`}
        </Button>
      </div>
    </form>
  );
}
