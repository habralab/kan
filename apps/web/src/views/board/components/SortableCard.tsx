import Link from "next/link";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { t } from "@lingui/core/macro";
import { env } from "next-runtime-env";

import type { CardDragData } from "../dnd/types";
import type { BoardCard, BoardData } from "../types";
import CardPreview from "./CardPreview";

interface SortableCardProps {
  card: BoardCard;
  listPublicId: string;
  cardPrefix: string;
  cardHref: string;
  canEditCard: boolean;
  onContextMenu: (event: React.MouseEvent, cardPublicId: string) => void;
  timeTrackingTotalSeconds?: number;
  isTimerRunning: boolean;
  customFields: BoardData["customFields"];
  canToggleCompletion: boolean;
  isCompletionPending: boolean;
  onToggleCompletion: (cardPublicId: string, completed: boolean) => void;
}

export default function SortableCard({
  card,
  listPublicId,
  cardPrefix,
  cardHref,
  canEditCard,
  onContextMenu,
  timeTrackingTotalSeconds,
  isTimerRunning,
  customFields,
  canToggleCompletion,
  isCompletionPending,
  onToggleCompletion,
}: SortableCardProps) {
  const isPlaceholder = card.publicId.startsWith("PLACEHOLDER");

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: card.publicId,
    data: { type: "CARD", listPublicId } satisfies CardDragData,
    disabled: !canEditCard || isPlaceholder,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };

  return (
    <div
      data-board-draggable
      onContextMenu={(e) => {
        if (isPlaceholder || env("NEXT_PUBLIC_KAN_ENV") === "cloud") return;
        e.preventDefault();
        onContextMenu(e, card.publicId);
      }}
      className={`group relative mb-2 flex flex-col ${
        isPlaceholder ? "pointer-events-none" : ""
      }`}
      ref={setNodeRef}
      style={style}
    >
      <CardPreview
        card={card}
        cardPrefix={cardPrefix}
        timeTrackingTotalSeconds={timeTrackingTotalSeconds}
        isTimerRunning={isTimerRunning}
        customFields={customFields}
        canToggleCompletion={canToggleCompletion && !isPlaceholder}
        isCompletionPending={isCompletionPending}
        onToggleCompletion={() =>
          onToggleCompletion(card.publicId, card.completed)
        }
      />
      <Link
        href={cardHref}
        aria-label={t`Open card ${card.title}`}
        className={`absolute inset-0 z-10 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-700 dark:focus-visible:ring-dark-700 ${
          canEditCard && !isPlaceholder && isDragging
            ? "cursor-grabbing"
            : "cursor-pointer"
        }`}
        {...(canEditCard && !isPlaceholder ? attributes : {})}
        {...(canEditCard && !isPlaceholder ? listeners : {})}
        role="link"
      />
    </div>
  );
}
