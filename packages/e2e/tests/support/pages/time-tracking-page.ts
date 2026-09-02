import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

import { waitForTrpcMutation } from "../wait-for-trpc";

export class TimeTrackingPage {
  constructor(private readonly page: Page) {}

  private cardSection() {
    return this.page.locator("section").filter({
      has: this.page.getByRole("heading", {
        name: "Time tracking",
        exact: true,
      }),
    });
  }

  async enableForCurrentBoard() {
    await this.page
      .getByRole("button", { name: "Board options", exact: true })
      .click();
    await this.page
      .getByRole("menuitem", { name: "Time tracking", exact: true })
      .click();

    const dialog = this.page.getByRole("dialog");
    await dialog
      .getByRole("switch", { name: "Enable time tracking", exact: true })
      .click();

    const updated = waitForTrpcMutation(
      this.page,
      "timeTracking.updateSettings",
    );
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await updated;
    await expect(dialog).toBeHidden();
  }

  async addTime({
    member,
    duration,
    comment,
  }: {
    member: string;
    duration: string;
    comment: string;
  }) {
    await this.cardSection()
      .getByRole("button", { name: "Add time", exact: true })
      .click();

    const dialog = this.page.getByRole("dialog");
    await dialog.getByRole("combobox").selectOption({
      label: member,
    });
    await dialog.getByLabel("Time", { exact: true }).fill(duration);
    await dialog.getByLabel("Comment", { exact: true }).fill(comment);

    const created = waitForTrpcMutation(
      this.page,
      "timeTracking.createWorklog",
    );
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await created;
    await expect(dialog).toBeHidden();
  }

  async expectCardTotal(duration: string) {
    await expect(
      this.cardSection().getByText(duration, { exact: true }).first(),
    ).toBeVisible();
  }

  async showTimeEntries() {
    await this.cardSection()
      .getByRole("button", { name: /^Time entries/ })
      .click();
  }

  async startTimer() {
    const started = waitForTrpcMutation(this.page, "timeTracking.startTimer");
    await this.cardSection()
      .getByRole("button", { name: "Start timer", exact: true })
      .click();
    await started;
  }

  async stopTimer() {
    const stopped = waitForTrpcMutation(this.page, "timeTracking.stopTimer");
    await this.cardSection()
      .getByRole("button", { name: "Stop", exact: true })
      .click();
    await stopped;
  }

  async expectRunningOnCurrentCard() {
    await expect(
      this.cardSection().getByText("Running on this card", { exact: true }),
    ).toBeVisible();
  }

  async openReport(): Promise<Locator> {
    await this.page.getByRole("button", { name: "Time", exact: true }).click();
    const dialog = this.page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: "Time report", exact: true }),
    ).toBeVisible();
    return dialog;
  }
}
