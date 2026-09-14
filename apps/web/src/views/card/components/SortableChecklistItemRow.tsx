import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { ChecklistAssignee } from "./ChecklistItemAssignee";
import ChecklistItemRow from "./ChecklistItemRow";

interface ChecklistItem {
  publicId: string;
  title: string;
  completed: boolean;
  dueDate: Date | null;
  dueDateHasTime: boolean;
  assignee: ChecklistAssignee | null;
  clientId?: string;
}

interface SortableChecklistItemRowProps {
  item: ChecklistItem;
  workspaceMembers?: ChecklistAssignee[];
  cardPublicId: string;
  onCreateNewItem: () => void;
  viewOnly: boolean;
}

export default function SortableChecklistItemRow({
  item,
  workspaceMembers = [],
  cardPublicId,
  onCreateNewItem,
  viewOnly,
}: SortableChecklistItemRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.publicId,
    disabled: viewOnly,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <ChecklistItemRow
        item={item}
        workspaceMembers={workspaceMembers}
        cardPublicId={cardPublicId}
        onCreateNewItem={onCreateNewItem}
        viewOnly={viewOnly}
        dragHandleAttributes={attributes}
        dragHandleListeners={listeners}
        isDragging={isDragging}
      />
    </div>
  );
}
