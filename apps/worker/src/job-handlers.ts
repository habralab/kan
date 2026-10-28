import type { JobHandler } from "@kan/jobs";

interface JobHandlerRegistration {
  name: string;
  handler: JobHandler;
}

// Product handlers are registered here once their queues and domain rules exist.
export const jobHandlers: readonly JobHandlerRegistration[] = [];
