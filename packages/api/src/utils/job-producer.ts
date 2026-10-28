import { JobScheduler, requirePostgresUrl } from "@kan/jobs";

let producerPromise: Promise<JobScheduler> | undefined;

export function getJobProducer(): Promise<JobScheduler> {
  producerPromise ??= (async () => {
    const producer = new JobScheduler({
      connectionString: requirePostgresUrl(),
      mode: "producer",
    });
    try {
      await producer.start();
      return producer;
    } catch (error) {
      await producer.stop();
      producerPromise = undefined;
      throw error;
    }
  })();
  return producerPromise;
}
