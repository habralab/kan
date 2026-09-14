import type { BoardCard, BoardData } from "../types";
import Card from "./Card";

interface CardPreviewProps {
  card: BoardCard;
  cardPrefix: string;
  timeTrackingTotalSeconds?: number;
  isTimerRunning?: boolean;
  customFields: BoardData["customFields"];
}

export default function CardPreview({
  card,
  cardPrefix,
  timeTrackingTotalSeconds,
  isTimerRunning,
  customFields,
}: CardPreviewProps) {
  return (
    <Card
      title={card.title}
      ticketNumber={
        card.cardNumber != null ? `${cardPrefix}-${card.cardNumber}` : null
      }
      labels={card.labels}
      members={card.members}
      summary={card.summary}
      checklists={card.checklists ?? []}
      description={card.description ?? null}
      comments={card.comments ?? []}
      attachments={card.attachments}
      dueDate={card.dueDate ?? null}
      timeTrackingTotalSeconds={timeTrackingTotalSeconds}
      isTimerRunning={isTimerRunning}
      customFields={customFields}
      customFieldValues={card.customFieldValues}
      cover={card.cover}
      completed={card.completed}
      dueDateHasTime={card.dueDateHasTime}
    />
  );
}
