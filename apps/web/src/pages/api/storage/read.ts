import { timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { NextApiRequest, NextApiResponse } from "next";
import { GetObjectCommand } from "@aws-sdk/client-s3";

import {
  createS3Client,
  getStorageReadMode,
  signStorageRead,
} from "@kan/shared/utils";

import { env } from "~/env";

const inlineImageTypes = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/svg+xml",
  "image/webp",
]);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "GET") {
    res.status(405).end();
    return;
  }

  if (getStorageReadMode() !== "proxy") {
    res.status(404).end();
    return;
  }

  const { bucket, key, expires, signature } = req.query;
  const avatarBucket = env.NEXT_PUBLIC_AVATAR_BUCKET_NAME;
  const attachmentBucket = env.NEXT_PUBLIC_ATTACHMENTS_BUCKET_NAME;
  if (
    typeof bucket !== "string" ||
    !bucket ||
    typeof key !== "string" ||
    !key ||
    (bucket !== avatarBucket && bucket !== attachmentBucket)
  ) {
    res.status(400).end();
    return;
  }

  // Avatar keys were already public in direct mode and are constructed in the
  // browser from user.image. Other objects need a short-lived server-issued URL.
  const isPublicAvatar =
    avatarBucket !== attachmentBucket &&
    bucket === avatarBucket &&
    !signature &&
    !expires;
  let maxAge = 300;
  if (!isPublicAvatar) {
    if (
      typeof expires !== "string" ||
      !/^\d{10}$/.test(expires) ||
      typeof signature !== "string" ||
      !/^[0-9a-f]{64}$/.test(signature)
    ) {
      res.status(403).end();
      return;
    }

    const expiresAt = Number(expires);
    maxAge = expiresAt - Math.floor(Date.now() / 1000);
    if (maxAge <= 0) {
      res.status(403).end();
      return;
    }

    const expected = Buffer.from(
      signStorageRead(bucket, key, expiresAt),
      "hex",
    );
    if (!timingSafeEqual(Buffer.from(signature, "hex"), expected)) {
      res.status(403).end();
      return;
    }
  }

  const range = req.headers.range;
  if (range && !/^bytes=\d*-\d*$/.test(range)) {
    res.status(416).end();
    return;
  }

  const client = createS3Client();
  try {
    const object = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key, Range: range }),
    );
    if (!(object.Body instanceof Readable)) {
      res.status(502).end();
      return;
    }

    const contentType = object.ContentType ?? "application/octet-stream";
    const isInlineImage = inlineImageTypes.has(
      contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "",
    );
    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      isInlineImage ? "inline" : "attachment",
    );
    res.setHeader("Content-Security-Policy", "sandbox");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Accept-Ranges", "bytes");
    if (object.ContentRange) {
      res.statusCode = 206;
      res.setHeader("Content-Range", object.ContentRange);
    }
    res.setHeader(
      "Cache-Control",
      `${isPublicAvatar ? "public" : "private"}, max-age=${Math.min(maxAge, 300)}`,
    );
    if (object.ContentLength !== undefined) {
      res.setHeader("Content-Length", object.ContentLength);
    }

    await pipeline(object.Body, res);
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error instanceof Error ? error : undefined);
      return;
    }

    const name = error instanceof Error ? error.name : "";
    const status =
      name === "NoSuchKey" || name === "NotFound"
        ? 404
        : name === "InvalidRange"
          ? 416
          : 502;
    res.status(status).end();
  } finally {
    client.destroy();
  }
}
