import type { DraggableProvided } from "react-beautiful-dnd";
import { t } from "@lingui/core/macro";
import { format } from "date-fns";
import { useEffect, useState } from "react";
import { HiOutlineCalendarDays, HiXMark } from "react-icons/hi2";
import { RiDraggable } from "react-icons/ri";
import { twMerge } from "tailwind-merge";

import type { ChecklistAssignee } from "./ChecklistItemAssignee";
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

  const commitDueDate = () => {
    setDateOpen(false);
    if (
      pendingDate?.getTime() === item.dueDate?.getTime() &&
      (!pendingDate || pendingHasTime === item.dueDateHasTime)
    )
      return;
    updateItem.mutate({
      checklistItemPublicId: item.publicId,
      dueDate: pendingDate,
      dueDateHasTime: pendingDate ? pendingHasTime : false,
    });
  };

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

      <div className="flex-1 pr-7">
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
        {(!viewOnly || item.dueDate !== null || item.assignee !== null) && (
          <div className="relative mt-1 flex items-center gap-1">
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
                onClick={() => setDateOpen(true)}
                aria-label={item.dueDate ? t`Edit due date` : t`Set due date`}
                className={twMerge(
                  "inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs text-light-700 hover:bg-light-200 dark:text-dark-700 dark:hover:bg-dark-200",
                  !item.dueDate &&
                    "sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100",
                )}
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
                <div className="fixed inset-0 z-10" onClick={commitDueDate} />
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
                </div>
              </>
            )}
            <ChecklistItemAssignee
              assignee={item.assignee}
              workspaceMembers={workspaceMembers}
              viewOnly={viewOnly}
              onSelect={(assigneePublicId) =>
                updateItem.mutate({
                  checklistItemPublicId: item.publicId,
                  assigneePublicId,
                })
              }
            />
          </div>
        )}
      </div>

      {!viewOnly && (
        <button
          type="button"
          onClick={handleDelete}
          className="absolute right-1 top-1/2 hidden -translate-y-1/2 rounded-md p-1 text-light-900 group-hover:block hover:bg-light-200 dark:text-dark-700 dark:hover:bg-dark-200"
        >
          <HiXMark size={16} />
        </button>
      )}
    </div>
  );
}
