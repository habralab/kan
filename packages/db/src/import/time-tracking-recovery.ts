const PUBLIC_ID_PATTERN = /^[0-9a-z]{12}$/;

export interface TimeTrackingRecoveryArguments {
  importRunPublicId: string;
  reason: string;
  apply: boolean;
}

export const parseTimeTrackingRecoveryArguments = (
  args: string[],
): TimeTrackingRecoveryArguments => {
  const importRunPublicId = args[0];
  if (!importRunPublicId || !PUBLIC_ID_PATTERN.test(importRunPublicId)) {
    throw new Error("A valid 12-character import run public ID is required");
  }

  let reason: string | undefined;
  let apply = false;

  for (let index = 1; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--apply") {
      if (apply) throw new Error("--apply may only be provided once");
      apply = true;
      continue;
    }
    if (argument === "--reason") {
      if (reason !== undefined)
        throw new Error("--reason may only be provided once");
      reason = args[++index]?.trim();
      if (!reason) throw new Error("--reason requires a value");
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }

  if (!reason || reason.length < 10)
    throw new Error("--reason must contain at least 10 characters");
  if (reason.length > 1000)
    throw new Error("--reason cannot exceed 1000 characters");

  return { importRunPublicId, reason, apply };
};
