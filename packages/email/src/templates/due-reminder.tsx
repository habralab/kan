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
}: {
  cardTitle: string;
  boardName: string;
  cardUrl: string;
}) {
  return (
    <Html>
      <Head />
      <Preview>Reminder for {cardTitle}</Preview>
      <Body style={{ backgroundColor: "white" }}>
        <Container
          style={{ fontFamily: "sans-serif", margin: "auto", padding: "24px" }}
        >
          <Heading>Card due reminder</Heading>
          <Text>
            This is a due reminder for <strong>{cardTitle}</strong> on{" "}
            <strong>{boardName}</strong>.
          </Text>
          <Button href={cardUrl}>View card</Button>
        </Container>
      </Body>
    </Html>
  );
}

export default DueReminderTemplate;
