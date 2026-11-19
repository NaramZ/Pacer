import { NextResponse, type NextRequest } from "next/server";

// Pacer holds people's resumes and job history, so it only ever answers this computer.

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const DEV = Boolean((import.meta as { env?: { DEV?: boolean } }).env?.DEV);

// The page may only talk to this app; nothing it loads or sends can reach another site.
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${DEV ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "worker-src 'self' blob:",
  `connect-src 'self'${DEV ? " ws://localhost:* ws://127.0.0.1:*" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

function deny(message: string) {
  return new NextResponse(message, { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

export function proxy(request: NextRequest) {
  // Blocks DNS rebinding: a website that points its own domain at 127.0.0.1 still sends its own Host.
  if (!LOCAL_HOST.test(request.headers.get("host") || "")) return deny("Pacer only answers requests from this computer.");

  if (request.method !== "GET" && request.method !== "HEAD") {
    // Blocks other websites from changing data through the person's browser.
    const origin = request.headers.get("origin");
    // The person's own browser extension may call its endpoints; they need its connection code.
    const fromExtension = /^(chrome|moz)-extension:\/\//.test(origin || "") && request.nextUrl.pathname.startsWith("/api/ext/");
    if (origin && origin !== "null" && !fromExtension && !LOCAL_HOST.test(new URL(origin).host)) return deny("Cross-site requests are not allowed.");
    if (origin === "null") return deny("Cross-site requests are not allowed.");
    // A JSON content type forces a CORS preflight for any cross-site attempt, which this app never approves.
    const type = request.headers.get("content-type") || "";
    const isRunner = request.nextUrl.pathname.startsWith("/api/runner/");
    if (request.nextUrl.pathname.startsWith("/api/") && !isRunner && request.method !== "DELETE" && !type.includes("application/json"))
      return deny("Requests must be JSON.");
  }

  const response = NextResponse.next();
  response.headers.set("Content-Security-Policy", CSP);
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), interest-cohort=()");
  if (request.nextUrl.pathname.startsWith("/api/")) response.headers.set("Cache-Control", "no-store");
  return response;
}

export const config = { matcher: "/:path*" };
