interface ChecklistItemPosition {
  publicId: string;
  completed: boolean;
}

export function visibleChecklistItems<T extends ChecklistItemPosition>(
  items: T[],
  hideCompleted: boolean,
): T[] {
  return hideCompleted ? items.filter((item) => !item.completed) : items;
}

export function checklistDestinationIndex(
  items: ChecklistItemPosition[],
  hideCompleted: boolean,
  visibleIndex: number,
): number {
  const destinationItem = visibleChecklistItems(items, hideCompleted)[
    visibleIndex
  ];
  return destinationItem
    ? items.findIndex((item) => item.publicId === destinationItem.publicId)
    : -1;
}
