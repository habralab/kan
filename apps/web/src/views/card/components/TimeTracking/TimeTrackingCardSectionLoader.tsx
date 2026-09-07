import dynamic from "next/dynamic";

import LoadingSpinner from "~/components/LoadingSpinner";
import { api } from "~/utils/api";

const TimeTrackingLoading = () => (
  <div className="mb-8 flex h-10 items-center text-light-900 dark:text-dark-900">
    <LoadingSpinner size="sm" />
  </div>
);

const TimeTrackingCardSection = dynamic(
  () =>
    import("./TimeTrackingCardSection").then(
      (module) => module.TimeTrackingCardSection,
    ),
  { loading: TimeTrackingLoading },
);

export function TimeTrackingCardSectionLoader({
  cardPublicId,
  boardPublicId,
}: {
  cardPublicId: string;
  boardPublicId: string;
}) {
  const settings = api.timeTracking.getSettings.useQuery(
    { boardPublicId },
    { enabled: !!boardPublicId },
  );
  const activeTimer = api.timeTracking.getActiveTimer.useQuery();

  if (settings.isLoading || activeTimer.isLoading)
    return <TimeTrackingLoading />;

  if (
    !settings.isError &&
    !activeTimer.isError &&
    settings.data?.enabled !== true &&
    !activeTimer.data
  )
    return null;

  return (
    <TimeTrackingCardSection
      cardPublicId={cardPublicId}
      boardPublicId={boardPublicId}
    />
  );
}
