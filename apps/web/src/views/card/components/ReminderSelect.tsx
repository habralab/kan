import { t } from "@lingui/core/macro";
import { useId } from "react";

interface ReminderSelectProps {
  value: number | null;
  enabled: boolean;
  dueDate: Date | null | undefined;
  onChange: (value: number | null) => void;
}

export function ReminderSelect({
  value,
  enabled,
  dueDate,
  onChange,
}: ReminderSelectProps) {
  const id = useId();
  const helperId = useId();
  const isPast =
    enabled &&
    dueDate &&
    value !== null &&
    dueDate.getTime() - value * 60_000 <= Date.now();

  return (
    <div className="space-y-1 text-sm text-light-900 dark:text-dark-900">
      <label htmlFor={id} className="block">{t`Email reminder`}</label>
      <select
        id={id}
        aria-describedby={helperId}
        value={enabled ? (value ?? "") : ""}
        disabled={!enabled}
        onChange={(event) =>
          onChange(
            event.target.value === "" ? null : Number(event.target.value),
          )
        }
        className="w-full rounded-md border border-light-300 bg-light-50 px-2 py-1 text-sm text-light-1000 disabled:opacity-60 dark:border-dark-300 dark:bg-dark-100 dark:text-dark-1000"
      >
        <option value="">{t`None`}</option>
        <option value="0">{t`At due time`}</option>
        <option value="5">{t`5 minutes before`}</option>
        <option value="10">{t`10 minutes before`}</option>
        <option value="15">{t`15 minutes before`}</option>
        <option value="60">{t`1 hour before`}</option>
        <option value="120">{t`2 hours before`}</option>
        <option value="1440">{t`1 day before`}</option>
        <option value="2880">{t`2 days before`}</option>
        <option value="10080">{t`7 days before`}</option>
      </select>
      <p id={helperId} className="text-xs text-light-700 dark:text-dark-700">
        {!enabled
          ? t`Set a due time to enable email reminders.`
          : isPast
            ? t`No reminder will be sent for this occurrence because the reminder time has passed.`
            : t`Active card members will receive an email.`}
      </p>
    </div>
  );
}
