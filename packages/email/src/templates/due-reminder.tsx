import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from "@react-email/components";
import * as React from "react";

export function DueReminderTemplate({
  cardTitle,
  boardName,
  cardUrl,
  dueAtText,
}: {
  cardTitle: string;
  boardName: string;
  cardUrl: string;
  dueAtText: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>
        {cardTitle} is due on {dueAtText}
      </Preview>
      <Body style={{ backgroundColor: "white" }}>
        <Container
          style={{ fontFamily: "sans-serif", margin: "auto", padding: "24px" }}
        >
          <Heading>Card due reminder</Heading>
          <Text>
            <strong>{cardTitle}</strong> on <strong>{boardName}</strong> is due
            on <strong>{dueAtText}</strong>.
          </Text>
          <Button href={cardUrl}>View card</Button>
        </Container>
      </Body>
    </Html>
  );
}

export default DueReminderTemplate;
