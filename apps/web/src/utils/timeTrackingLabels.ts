import { t } from "@lingui/core/macro";

import type { TimeTrackingPeriod } from "./timeTracking";

export const getTimeTrackingPeriodOptions = () =>
  [
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
