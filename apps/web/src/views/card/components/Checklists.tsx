import type { DragEndEvent } from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { t } from "@lingui/core/macro";
import { useState } from "react";
import { HiPlus, HiXMark } from "react-icons/hi2";

import type { ChecklistAssignee } from "./ChecklistItemAssignee";
import CircularProgress from "~/components/CircularProgress";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import {
  checklistDestinationIndex,
  visibleChecklistItems,
} from "./checklist-items";
import ChecklistNameInput from "./ChecklistNameInput";
import NewChecklistItemForm from "./NewChecklistItemForm";
import SortableChecklistItemRow from "./SortableChecklistItemRow";

interface ChecklistItem {
  publicId: string;
  title: string;
  completed: boolean;
  dueDate: Date | null;
  dueDateHasTime: boolean;
  assignee: ChecklistAssignee | null;
  clientId?: string;
}

interface Checklist {
  publicId: string;
  name: string;
  items: ChecklistItem[];
}

interface ChecklistsProps {
  checklists: Checklist[];
  cardPublicId: string;
  activeChecklistForm?: string | null;
  setActiveChecklistForm?: (id: string | null) => void;
  viewOnly?: boolean;
  workspaceMembers?: ChecklistAssignee[];
}

export default function Checklists({
  checklists,
  cardPublicId,
  activeChecklistForm,
  setActiveChecklistForm,
  viewOnly = false,
  workspaceMembers = [],
}: ChecklistsProps) {
  const { openModal } = useModal();
  const { showPopup } = usePopup();
  const [hiddenCompleted, setHiddenCompleted] = useState<string[]>([]);

  const utils = api.useUtils();

  const reorderItemMutation = api.checklist.updateItem.useMutation({
    onMutate: async (vars) => {
      await utils.card.byId.cancel({ cardPublicId });
      const previous = utils.card.byId.getData({ cardPublicId });

      utils.card.byId.setData({ cardPublicId }, (old) => {
        if (!old) return old;

        const updatedChecklists = old.checklists.map((cl) => {
          const itemIndex = cl.items.findIndex(
            (item) => item.publicId === vars.checklistItemPublicId,
          );

          if (itemIndex === -1 || vars.index === undefined) return cl;

          const newIndex = vars.index;
          const items = Array.from(cl.items);
          const [movedItem] = items.splice(itemIndex, 1);
          if (!movedItem) return cl;
          items.splice(newIndex, 0, movedItem);

          return { ...cl, items };
        });

        return { ...old, checklists: updatedChecklists } as typeof old;
      });

      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous)
        utils.card.byId.setData({ cardPublicId }, ctx.previous);
      showPopup({
        header: t`Unable to reorder checklist item`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
    onSettled: async () => {
      await utils.card.byId.invalidate({ cardPublicId });
    },
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;

    const checklist = checklists.find((cl) =>
      cl.items.some((item) => item.publicId === active.id),
    );
    if (!checklist) return;

    const hideCompleted = hiddenCompleted.includes(checklist.publicId);
    const visibleItems = visibleChecklistItems(checklist.items, hideCompleted);
    const overIndex = visibleItems.findIndex(
      (item) => item.publicId === over.id,
    );
    if (overIndex === -1) return;

    const oldIndex = checklist.items.findIndex(
      (item) => item.publicId === active.id,
    );
    const destinationIndex = checklistDestinationIndex(
      checklist.items,
      hideCompleted,
      overIndex,
    );
    if (destinationIndex === -1 || oldIndex === destinationIndex) return;

    reorderItemMutation.mutate({
      checklistItemPublicId: String(active.id),
      index: destinationIndex,
    });
  };

  if (checklists.length === 0) return null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <div className="border-light-300 pb-4 dark:border-dark-300">
        <div>
          {checklists.map((checklist) => {
            const completedItems = checklist.items.filter(
              (item) => item.completed,
            );
            const progress =
              checklist.items.length > 0 && completedItems.length > 0
                ? (completedItems.length / checklist.items.length) * 100
                : 2;
            const hideCompleted = hiddenCompleted.includes(checklist.publicId);
            const visibleItems = visibleChecklistItems(
              checklist.items,
              hideCompleted,
            );

            return (
              <div key={checklist.publicId} className="mb-4">
                <div className="mb-2 flex items-center font-medium text-light-1000 dark:text-dark-1000">
                  <div className="min-w-0 flex-1">
                    <ChecklistNameInput
                      checklistPublicId={checklist.publicId}
                      initialName={checklist.name}
                      cardPublicId={cardPublicId}
                      viewOnly={viewOnly}
                    />
                  </div>
                  {!viewOnly && (
                    <div className="ml-2 flex flex-shrink-0 items-center gap-2">
                      <div className="flex items-center gap-1 rounded-full border-[1px] border-light-300 px-2 py-1 dark:border-dark-300">
                        <CircularProgress
                          progress={progress}
                          size="sm"
                          className="flex-shrink-0"
                        />
                        <span className="text-[11px] text-light-900 dark:text-dark-700">
                          {completedItems.length}/{checklist.items.length}
                        </span>
                      </div>
                      <div>
                        <button
                          aria-label={t`Delete checklist`}
                          className="rounded-md p-1 text-light-900 hover:bg-light-100 dark:text-dark-700 dark:hover:bg-dark-100"
                          onClick={() =>
                            openModal("DELETE_CHECKLIST", checklist.publicId)
                          }
                        >
                          <HiXMark size={16} />
                        </button>
                        <button
                          aria-label={t`Add checklist item`}
                          onClick={() =>
                            setActiveChecklistForm?.(checklist.publicId)
                          }
                          className="rounded-md p-1 text-light-900 hover:bg-light-100 dark:text-dark-700 dark:hover:bg-dark-100"
                        >
                          <HiPlus size={16} />
                        </button>
                      </div>
                    </div>
                  )}
                  {viewOnly && (
                    <div className="ml-2 flex flex-shrink-0 items-center gap-2">
                      <div className="flex items-center gap-1 rounded-full border-[1px] border-light-300 px-2 py-1 dark:border-dark-300">
                        <CircularProgress
                          progress={progress}
                          size="sm"
                          className="flex-shrink-0"
                        />
                        <span className="text-[11px] text-light-900 dark:text-dark-700">
                          {completedItems.length}/{checklist.items.length}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {completedItems.length > 0 && (
                  <div className="mb-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() =>
                        setHiddenCompleted((current) =>
                          hideCompleted
                            ? current.filter((id) => id !== checklist.publicId)
                            : [...current, checklist.publicId],
                        )
                      }
                      className="rounded-md px-1 text-xs text-light-900 hover:text-light-1000 dark:text-dark-900 dark:hover:text-dark-1000"
                    >
                      {hideCompleted
                        ? t`Show completed items`
                        : t`Hide completed items`}
                    </button>
                  </div>
                )}

                <SortableContext
                  items={visibleItems.map((item) => item.publicId)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="ml-1">
                    {visibleItems.map((item) => (
                      <SortableChecklistItemRow
                        key={item.clientId ?? item.publicId}
                        item={{
                          publicId: item.publicId,
                          title: item.title,
                          completed: item.completed,
                          clientId: item.clientId,
                          dueDate: item.dueDate,
                          dueDateHasTime: item.dueDateHasTime,
                          assignee: item.assignee,
                        }}
                        workspaceMembers={workspaceMembers}
                        cardPublicId={cardPublicId}
                        onCreateNewItem={() =>
                          setActiveChecklistForm?.(checklist.publicId)
                        }
                        viewOnly={viewOnly}
                      />
                    ))}
                  </div>
                </SortableContext>
                {activeChecklistForm === checklist.publicId && !viewOnly && (
                  <div className="ml-1">
                    <NewChecklistItemForm
                      checklistPublicId={checklist.publicId}
                      cardPublicId={cardPublicId}
                      onCancel={() => setActiveChecklistForm?.(null)}
                      readOnly={viewOnly}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </DndContext>
  );
}
