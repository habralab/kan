import type { DraggableProvided } from "react-beautiful-dnd";
import { t } from "@lingui/core/macro";
import { format } from "date-fns";
import { useEffect, useState } from "react";
import { HiOutlineCalendarDays, HiXMark } from "react-icons/hi2";
import { RiDraggable } from "react-icons/ri";
import { twMerge } from "tailwind-merge";

import type { ChecklistAssignee } from "./ChecklistItemAssignee";
import Button from "~/components/Button";
import DateSelector from "~/components/DateSelector";
import PlainTextEditor from "~/components/PlainTextEditor";
import { useLocalisation } from "~/hooks/useLocalisation";
import { usePopup } from "~/providers/popup";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";
import { invalidateCard } from "~/utils/cardInvalidation";
import { ChecklistItemAssignee } from "./ChecklistItemAssignee";

interface ChecklistItemRowProps {
  item: {
    publicId: string;
    title: string;
    completed: boolean;
    dueDate: Date | null;
    dueDateHasTime: boolean;
    assignee: ChecklistAssignee | null;
    clientId?: string;
  };
  workspaceMembers?: ChecklistAssignee[];
  cardPublicId: string;
  onCreateNewItem?: () => void;
  viewOnly?: boolean;
  dragHandleProps?: DraggableProvided["dragHandleProps"];
  isDragging?: boolean;
}

export default function ChecklistItemRow({
  item,
  workspaceMembers = [],
  cardPublicId,
  onCreateNewItem,
  viewOnly = false,
  dragHandleProps,
  isDragging = false,
}: ChecklistItemRowProps) {
  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const { workspace } = useWorkspace();
  const { dateLocale } = useLocalisation();
  const [completed, setCompleted] = useState(item.completed);
  const [dateOpen, setDateOpen] = useState(false);
  const [pendingDate, setPendingDate] = useState(item.dueDate);
  const [pendingHasTime, setPendingHasTime] = useState(item.dueDateHasTime);

  useEffect(() => {
    if (!dateOpen) {
      setPendingDate(item.dueDate);
      setPendingHasTime(item.dueDateHasTime);
    }
  }, [dateOpen, item.dueDate, item.dueDateHasTime]);

  const updateItem = api.checklist.updateItem.useMutation({
    onMutate: async (vars) => {
      await utils.card.byId.cancel({ cardPublicId });
      const previous = utils.card.byId.getData({ cardPublicId });
      utils.card.byId.setData({ cardPublicId }, (old) => {
        if (!old) return old;
        const updatedChecklists = old.checklists.map((cl) => ({
          ...cl,
          items: cl.items.map((ci) =>
            ci.publicId === item.publicId
              ? {
                  ...ci,
                  ...(vars.title !== undefined ? { title: vars.title } : {}),
                  ...(vars.completed !== undefined
                    ? { completed: vars.completed }
                    : {}),
                  ...(vars.dueDate !== undefined
                    ? {
                        dueDate: vars.dueDate,
                        dueDateHasTime: vars.dueDate
                          ? (vars.dueDateHasTime ?? false)
                          : false,
                      }
                    : {}),
                  ...(vars.assigneePublicId !== undefined
                    ? {
                        assignee: vars.assigneePublicId
                          ? (workspaceMembers.find(
                              (member) =>
                                member.publicId === vars.assigneePublicId,
                            ) ?? null)
                          : null,
                      }
                    : {}),
                }
              : ci,
          ),
        }));
        return { ...old, checklists: updatedChecklists } as typeof old;
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous)
        utils.card.byId.setData({ cardPublicId }, ctx.previous);
      showPopup({
        header: t`Unable to update checklist item`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
    onSettled: async () => {
      await invalidateCard(utils, cardPublicId);
    },
  });

  const deleteItem = api.checklist.deleteItem.useMutation({
    onMutate: async () => {
      await utils.card.byId.cancel({ cardPublicId });
      const previous = utils.card.byId.getData({ cardPublicId });
      utils.card.byId.setData({ cardPublicId }, (old) => {
        if (!old) return old;
        const updatedChecklists = old.checklists.map((cl) => ({
          ...cl,
          items: cl.items.filter((ci) => ci.publicId !== item.publicId),
        }));
        return { ...old, checklists: updatedChecklists } as typeof old;
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous)
        utils.card.byId.setData({ cardPublicId }, ctx.previous);
      showPopup({
        header: t`Unable to delete checklist item`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
    onSettled: async () => {
      await invalidateCard(utils, cardPublicId);
    },
  });

  const handleToggleCompleted = () => {
    if (viewOnly) return;
    setCompleted((prev) => !prev);
    updateItem.mutate({
      checklistItemPublicId: item.publicId,
      completed: !completed,
    });
  };

  const commitTitle = (plain: string) => {
    if (!plain || plain === item.title) return;
    updateItem.mutate({
      checklistItemPublicId: item.publicId,
      title: plain,
    });
  };

  const handleDelete = () => {
    if (viewOnly) return;
    deleteItem.mutate({ checklistItemPublicId: item.publicId });
  };

  const cancelDueDate = () => {
    setDateOpen(false);
  };

  const dueDateHasChanges =
    pendingDate?.getTime() !== item.dueDate?.getTime() ||
    (!!pendingDate && pendingHasTime !== item.dueDateHasTime);

  const saveDueDate = () => {
    setDateOpen(false);
    if (!dueDateHasChanges) return;

    updateItem.mutate({
      checklistItemPublicId: item.publicId,
      dueDate: pendingDate,
      dueDateHasTime: pendingDate ? pendingHasTime : false,
    });
  };

  const hasMetadata =
    item.dueDate !== null || item.assignee !== null || dateOpen;
  const metadataControls = (!viewOnly || hasMetadata) && (
    <div
      className={twMerge(
        "relative flex items-center gap-1",
        hasMetadata
          ? "mt-1 flex-wrap"
          : "flex-shrink-0 sm:opacity-0 sm:transition-opacity sm:group-focus-within:opacity-100 sm:group-hover:opacity-100",
      )}
    >
      {viewOnly ? (
        item.dueDate && (
          <span className="inline-flex items-center gap-1 text-xs text-light-700 dark:text-dark-700">
            <HiOutlineCalendarDays size={14} />
            {format(item.dueDate, item.dueDateHasTime ? "PPp" : "PP", {
              locale: dateLocale,
            })}
          </span>
        )
      ) : (
        <button
          type="button"
          onClick={() => {
            setPendingDate(item.dueDate);
            setPendingHasTime(item.dueDateHasTime);
            setDateOpen(true);
          }}
          aria-label={
            item.dueDate
              ? t`Edit checklist item due date`
              : t`Set checklist item due date`
          }
          className="inline-flex h-7 items-center gap-1 rounded px-1 text-xs text-light-700 hover:bg-light-200 dark:text-dark-700 dark:hover:bg-dark-200 sm:h-5"
        >
          <HiOutlineCalendarDays size={14} />
          {item.dueDate &&
            format(item.dueDate, item.dueDateHasTime ? "PPp" : "PP", {
              locale: dateLocale,
            })}
        </button>
      )}
      {dateOpen && !viewOnly && (
        <>
          <div className="fixed inset-0 z-10" onClick={cancelDueDate} />
          <div
            className="absolute left-0 top-full z-20 mt-2 rounded-md border border-light-200 bg-light-50 shadow-lg dark:border-dark-200 dark:bg-dark-100"
            onClick={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <DateSelector
              selectedDate={pendingDate ?? undefined}
              onDateSelect={(date) => setPendingDate(date ?? null)}
              weekStartsOn={workspace.weekStartDay}
              showTime
              timeEnabled={pendingHasTime}
              onTimeEnabledChange={setPendingHasTime}
            />
            <div className="flex items-center justify-between gap-2 border-t border-light-200 px-4 py-3 dark:border-dark-200">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => {
                  setPendingDate(null);
                  setPendingHasTime(false);
                }}
                disabled={!pendingDate}
              >
                {t`Clear date`}
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  onClick={cancelDueDate}
                >
                  {t`Cancel`}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  onClick={saveDueDate}
                  disabled={!dueDateHasChanges}
                >
                  {t`Save`}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
      <ChecklistItemAssignee
        assignee={item.assignee}
        workspaceMembers={workspaceMembers}
        viewOnly={viewOnly}
        align={hasMetadata ? "left" : "right"}
        onSelect={(assigneePublicId) =>
          updateItem.mutate({
            checklistItemPublicId: item.publicId,
            assigneePublicId,
          })
        }
      />
    </div>
  );

  return (
    <div
      className={twMerge(
        "group relative flex items-start gap-3 rounded-md py-2 pl-4 hover:bg-light-100 dark:hover:bg-dark-100",
        isDragging && "opacity-80",
      )}
    >
      {!viewOnly && (
        <div
          {...dragHandleProps}
          className="absolute left-0 top-1/2 flex h-[20px] w-[20px] -translate-x-full -translate-y-1/2 cursor-grab items-center justify-center pr-1 opacity-0 transition-opacity group-hover:opacity-75 hover:opacity-100 active:cursor-grabbing"
        >
          <RiDraggable className="h-4 w-4 text-light-700 dark:text-dark-700" />
        </div>
      )}

      {viewOnly && <div className="w-[20px] flex-shrink-0" />}

      <label
        className={`relative mt-[2px] inline-flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center`}
      >
        <input
          type="checkbox"
          aria-label={
            completed
              ? t`Mark “${item.title}” incomplete`
              : t`Mark “${item.title}” complete`
          }
          checked={completed}
          onChange={(e) => {
            if (viewOnly) {
              e.preventDefault();
              return;
            }
            handleToggleCompleted();
          }}
          className={twMerge(
            "h-[16px] w-[16px] appearance-none rounded-md border border-light-500 bg-transparent outline-none ring-0 checked:bg-blue-600 focus:shadow-none focus:ring-0 focus:ring-offset-0 focus-visible:outline-none dark:border-dark-500 dark:hover:border-dark-500",
            viewOnly ? "cursor-default" : "cursor-pointer",
          )}
        />
      </label>

      <div className="flex min-w-0 flex-1 items-start gap-1 pr-7">
        <div className="min-w-0 flex-1">
          <PlainTextEditor
            key={item.clientId ?? item.publicId}
            content={item.title}
            readOnly={viewOnly}
            placeholder={t`Add details...`}
            onBlur={commitTitle}
            onEnter={(plain) => {
              commitTitle(plain);
              onCreateNewItem?.();
            }}
            onEscape={() => undefined}
            className={twMerge(
              "m-0 min-h-[20px] w-full p-0 text-sm leading-[20px] text-light-950 dark:text-dark-950",
              viewOnly && "cursor-default",
            )}
          />
          {hasMetadata && metadataControls}
        </div>
        {!hasMetadata && metadataControls}
      </div>

      {!viewOnly && (
        <button
          type="button"
          aria-label={t`Delete checklist item “${item.title}”`}
          onClick={handleDelete}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-light-900 transition-opacity hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-700 dark:text-dark-700 dark:hover:bg-dark-200 dark:focus-visible:ring-dark-700 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
        >
          <HiXMark size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
