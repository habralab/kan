import { t } from "@lingui/core/macro";
import { Plural, Trans } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { HiXMark } from "react-icons/hi2";

import Button from "~/components/Button";
import LoadingSpinner from "~/components/LoadingSpinner";
import Toggle from "~/components/Toggle";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";

export function TimeTrackingSettingsForm({
  boardPublicId,
  isArchived,
}: {
  boardPublicId: string;
  isArchived: boolean;
}) {
  const { closeModal } = useModal();
  const { showPopup } = usePopup();
  const utils = api.useUtils();
  const [enabled, setEnabled] = useState(false);

  const settings = api.timeTracking.getSettings.useQuery(
    { boardPublicId },
    { enabled: !!boardPublicId },
  );

  useEffect(() => {
    if (settings.data) setEnabled(settings.data.enabled);
  }, [settings.data]);

  const updateSettings = api.timeTracking.updateSettings.useMutation({
    onSuccess: async () => {
      await utils.timeTracking.getSettings.invalidate({ boardPublicId });
      closeModal();
      showPopup({
        header: t`Time tracking updated`,
        message: enabled
          ? t`Time tracking is now available on this board.`
          : t`Time tracking has been disabled. Existing history is preserved.`,
        icon: "success",
      });
    },
    onError: (error) => {
      showPopup({
        header: t`Unable to update time tracking`,
        message: error.message,
        icon: "error",
      });
    },
  });

  const currentEnabled = settings.data?.enabled ?? false;
  const cannotEnableArchivedBoard = isArchived && !currentEnabled;
  const hasChanges = enabled !== currentEnabled;

  return (
    <div className="p-5">
      <div className="flex items-center justify-between pb-4">
        <h2 className="text-sm font-bold text-neutral-900 dark:text-dark-1000">
          {t`Time tracking`}
        </h2>
        <button
          type="button"
          className="rounded p-1 hover:bg-light-200 focus:outline-none dark:hover:bg-dark-300"
          onClick={closeModal}
          aria-label={t`Close`}
        >
          <HiXMark size={18} className="text-light-900 dark:text-dark-900" />
        </button>
      </div>

      {settings.isLoading ? (
        <div className="flex min-h-28 items-center justify-center text-light-900 dark:text-dark-900">
          <LoadingSpinner />
        </div>
      ) : settings.isError ? (
        <div className="space-y-4">
          <p role="alert" className="text-sm text-red-700 dark:text-red-500">
            {t`Unable to load time tracking settings.`}
          </p>
          <Button variant="secondary" onClick={() => void settings.refetch()}>
            {t`Try again`}
          </Button>
        </div>
      ) : settings.data ? (
        <>
          <div className="flex items-start justify-between gap-6 rounded-md border border-light-600 p-4 dark:border-dark-600">
            <div>
              <p className="text-sm font-medium text-light-1000 dark:text-dark-1000">
                {t`Enable time tracking`}
              </p>
              <p className="mt-1 text-xs leading-5 text-light-900 dark:text-dark-900">
                {t`Members can add time entries and run timers on cards. Disabling this feature keeps existing history.`}
              </p>
            </div>
            <Toggle
              isChecked={enabled}
              onChange={() => setEnabled((value) => !value)}
              label={t`Enable time tracking`}
              showLabel={false}
              disabled={
                !settings.data.canUpdate ||
                cannotEnableArchivedBoard ||
                updateSettings.isPending
              }
            />
          </div>

          {settings.data.activeTimerCount > 0 && (
            <p className="mt-3 text-xs text-light-900 dark:text-dark-900">
              <Trans>
                <Plural
                  value={settings.data.activeTimerCount}
                  one="1 active timer can still be stopped or discarded if time tracking is disabled."
                  other={`${settings.data.activeTimerCount} active timers can still be stopped or discarded if time tracking is disabled.`}
                />
              </Trans>
            </p>
          )}

          {cannotEnableArchivedBoard && (
            <p className="mt-3 text-xs text-light-900 dark:text-dark-900">
              {t`Unarchive this board before enabling time tracking.`}
            </p>
          )}

          {!settings.data.canUpdate && (
            <p className="mt-3 text-xs text-light-900 dark:text-dark-900">
              {t`You don't have permission to change this setting.`}
            </p>
          )}

          <div className="mt-6 flex justify-end space-x-2">
            <Button variant="secondary" onClick={closeModal}>
              {t`Cancel`}
            </Button>
            <Button
              onClick={() => updateSettings.mutate({ boardPublicId, enabled })}
              isLoading={updateSettings.isPending ? true : undefined}
              disabled={
                updateSettings.isPending ||
                !settings.data.canUpdate ||
                !hasChanges
              }
            >
              {t`Save`}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
