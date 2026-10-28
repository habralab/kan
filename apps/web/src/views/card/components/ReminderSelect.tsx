import { t } from "@lingui/core/macro";
import { useId } from "react";

import type { CardDueReminderCustom } from "@kan/shared/utils";
import {
  customReminderInstant,
  isValidViewerTimeZone,
} from "@kan/shared/utils";

import {
  customReminderFromInput,
  customReminderInputValue,
  detectedTimeZone,
} from "./reminder-custom";

interface ReminderSelectProps {
  value: number | null;
  custom: CardDueReminderCustom | null;
  enabled: boolean;
  timeEnabled: boolean;
  dueDate: Date | null | undefined;
  onChange: (
    value: number | null,
    custom: CardDueReminderCustom | null,
  ) => void;
}

export function ReminderSelect({
  value,
  custom,
  enabled,
  timeEnabled,
  dueDate,
  onChange,
}: ReminderSelectProps) {
  const id = useId();
  const helperId = useId();
  let customInstant: Date | null = null;
  let customValid = true;
  if (enabled && dueDate && custom) {
    try {
      customInstant = customReminderInstant(dueDate, custom);
      customValid =
        !timeEnabled || customInstant.getTime() <= dueDate.getTime();
    } catch {
      customValid = false;
    }
  }
  const reminderTime =
    customInstant ??
    (dueDate && value !== null && timeEnabled
      ? dueDate.getTime() - value * 60_000
      : null);
  const isPast =
    reminderTime !== null &&
    (typeof reminderTime === "number"
      ? reminderTime
      : reminderTime.getTime()) <= Date.now();

  const selected = custom ? "custom" : (value?.toString() ?? "");
  const customDate =
    custom && dueDate && isValidViewerTimeZone(custom.timezone)
      ? customReminderInputValue(dueDate, custom)
      : "";
  const resolvedLocalTime =
    custom && customInstant
      ? new Intl.DateTimeFormat("en-GB", {
          timeZone: custom.timezone,
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(customInstant)
      : null;

  return (
    <div className="space-y-2 text-sm text-light-900 dark:text-dark-900">
      <label htmlFor={id} className="block">
        {t`Email reminder`}
      </label>
      <select
        id={id}
        aria-describedby={helperId}
        value={enabled ? selected : ""}
        disabled={!enabled}
        onChange={(event) => {
          if (event.target.value === "custom" && dueDate) {
            const timezone = detectedTimeZone();
            const dueLocal = new Intl.DateTimeFormat("en-GB", {
              timeZone: timezone,
              hour: "2-digit",
              minute: "2-digit",
              hourCycle: "h23",
            }).format(dueDate);
            onChange(null, {
              daysBefore: 0,
              time: timeEnabled ? dueLocal : "09:00",
              timezone,
            });
          } else {
            onChange(
              event.target.value === "" ? null : Number(event.target.value),
              null,
            );
          }
        }}
        className="w-full rounded-md border border-light-300 bg-light-50 px-2 py-1 text-sm text-light-1000 disabled:opacity-60 dark:border-dark-300 dark:bg-dark-100 dark:text-dark-1000"
      >
        <option value="">{t`None`}</option>
        <option value="0" disabled={!timeEnabled}>{t`At due time`}</option>
        <option value="5" disabled={!timeEnabled}>{t`5 minutes before`}</option>
        <option
          value="10"
          disabled={!timeEnabled}
        >{t`10 minutes before`}</option>
        <option
          value="15"
          disabled={!timeEnabled}
        >{t`15 minutes before`}</option>
        <option value="60" disabled={!timeEnabled}>{t`1 hour before`}</option>
        <option value="120" disabled={!timeEnabled}>{t`2 hours before`}</option>
        <option value="1440" disabled={!timeEnabled}>{t`1 day before`}</option>
        <option value="2880" disabled={!timeEnabled}>{t`2 days before`}</option>
        <option
          value="10080"
          disabled={!timeEnabled}
        >{t`7 days before`}</option>
        <option value="custom">{t`At a specific time`}</option>
      </select>
      {custom && dueDate && (
        <div className="space-y-2">
          <label className="block">
            {t`Reminder date and time`}
            <input
              type="datetime-local"
              value={customDate}
              onChange={(event) => {
                if (!isValidViewerTimeZone(custom.timezone)) return;
                const next = customReminderFromInput(
                  dueDate,
                  event.target.value,
                  custom.timezone,
                );
                if (next) onChange(null, next);
              }}
              className="mt-1 w-full rounded-md border border-light-300 bg-light-50 px-2 py-1 text-sm text-light-1000 dark:border-dark-300 dark:bg-dark-100 dark:text-dark-1000"
            />
          </label>
          <label className="block">
            {t`Time zone`}
            <input
              type="text"
              value={custom.timezone}
              onChange={(event) =>
                onChange(null, { ...custom, timezone: event.target.value })
              }
              className="mt-1 w-full rounded-md border border-light-300 bg-light-50 px-2 py-1 text-sm text-light-1000 dark:border-dark-300 dark:bg-dark-100 dark:text-dark-1000"
            />
          </label>
          <p className="text-xs text-light-700 dark:text-dark-700">
            {t`Detected from your browser and saved with this card.`}
          </p>
        </div>
      )}
      {custom && resolvedLocalTime && resolvedLocalTime !== custom.time && (
        <p className="text-xs text-light-700 dark:text-dark-700">
          {t`This local time does not exist on that date. The reminder will be sent at ${resolvedLocalTime}.`}
        </p>
      )}
      <p id={helperId} className="text-xs text-light-700 dark:text-dark-700">
        {!enabled
          ? t`Set a due date to enable email reminders.`
          : custom && !customValid
            ? t`Choose a valid time zone and a reminder no later than the due time.`
            : !timeEnabled && !custom
              ? t`Set a due time to use relative reminders.`
              : isPast
                ? t`No reminder will be sent for this occurrence because the reminder time has passed.`
                : t`Active card members will receive an email.`}
      </p>
    </div>
  );
}
