import type { IncomingMessage } from "node:http";

// Fixed-window counter per key. Good enough for a single-instance server.
export class RateLimiter {
  private windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private limit: number,
    private windowMs: number,
  ) {}

  // Counts one hit and returns false once the key is over the limit.
  allow(key: string, now = Date.now()): boolean {
    const entry = this.windows.get(key);
    if (!entry || now >= entry.resetAt) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }

  // Drop expired windows so the map does not grow forever.
  prune(now = Date.now()): void {
    for (const [key, entry] of this.windows) {
      if (now >= entry.resetAt) this.windows.delete(key);
    }
  }
}

// Behind a proxy (Render) the socket address is the proxy, so use the last
// X-Forwarded-For entry, which is the one the nearest proxy added.
export function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const value = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
  const last = value
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .pop();
  return last ?? req.socket.remoteAddress ?? "unknown";
}
