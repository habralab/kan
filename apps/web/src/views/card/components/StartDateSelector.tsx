import { t } from "@lingui/core/macro";
import { format } from "date-fns";
import { useEffect, useState } from "react";
import { HiMiniPlus } from "react-icons/hi2";

import DateSelector from "~/components/DateSelector";
import { useLocalisation } from "~/hooks/useLocalisation";
import { usePopup } from "~/providers/popup";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";
import { invalidateCard } from "~/utils/cardInvalidation";

interface StartDateSelectorProps {
  cardPublicId: string;
  startDate: Date | null | undefined;
  isLoading?: boolean;
  disabled?: boolean;
}

export function StartDateSelector({
  cardPublicId,
  startDate,
  isLoading = false,
  disabled = false,
}: StartDateSelectorProps) {
  const { showPopup } = usePopup();
  const { workspace } = useWorkspace();
  const { dateLocale } = useLocalisation();
  const utils = api.useUtils();
  const [isOpen, setIsOpen] = useState(false);
  const [pendingDate, setPendingDate] = useState<Date | null>(
    startDate ?? null,
  );

  useEffect(() => {
    if (!isOpen) setPendingDate(startDate ?? null);
  }, [isOpen, startDate]);

  const updateStartDate = api.card.update.useMutation({
    onMutate: async ({ startDate: nextDate }) => {
      await utils.card.byId.cancel();
      const previousCard = utils.card.byId.getData({ cardPublicId });
      utils.card.byId.setData({ cardPublicId }, (card) =>
        card ? { ...card, startDate: nextDate ?? null } : card,
      );
      return { previousCard };
    },
    onError: (_error, _input, context) => {
      utils.card.byId.setData({ cardPublicId }, context?.previousCard);
      showPopup({
        header: t`Unable to update start date`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
    onSettled: async () => {
      await invalidateCard(utils, cardPublicId);
      await utils.board.byId.invalidate();
    },
  });

  const close = () => {
    setIsOpen(false);
    if (pendingDate?.getTime() !== startDate?.getTime()) {
      updateStartDate.mutate({ cardPublicId, startDate: pendingDate });
    }
  };

  return (
    <div className="relative flex w-full items-center text-left">
      <button
        type="button"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={isLoading || disabled}
        className={`flex h-full w-full items-center rounded-[5px] border-[1px] border-light-50 py-1 pl-2 text-left text-xs text-neutral-900 dark:border-dark-50 dark:text-dark-1000 ${disabled ? "cursor-not-allowed opacity-60" : "hover:border-light-300 hover:bg-light-200 dark:hover:border-dark-200 dark:hover:bg-dark-100"}`}
      >
        {startDate ? (
          <span>
            {format(startDate, "MMM d, yyyy", { locale: dateLocale })}
          </span>
        ) : (
          <>
            <HiMiniPlus size={22} className="pr-2" />
            {t`Set start date`}
          </>
        )}
      </button>
      {isOpen && !disabled && (
        <>
          <div className="fixed inset-0 z-10" onClick={close} />
          <div
            className="absolute -left-8 top-full z-20 mt-2 rounded-md border border-light-200 bg-light-50 shadow-lg dark:border-dark-200 dark:bg-dark-100"
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <DateSelector
              selectedDate={pendingDate ?? undefined}
              onDateSelect={(date) => setPendingDate(date ?? null)}
              weekStartsOn={workspace.weekStartDay}
            />
          </div>
        </>
      )}
    </div>
  );
}
