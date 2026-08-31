import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { env } from "next-runtime-env";

export function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === "/") {
    if (env("NEXT_PUBLIC_KAN_ENV") !== "cloud") {
      // In standalone deployments request.url is built from the internal
      // listener address, even when a reverse proxy forwards the public Host.
      const loginUrl = new URL(
        "/login",
        env("NEXT_PUBLIC_BASE_URL") ?? request.url,
      );
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/"],
};
