import { randomInt } from "node:crypto";

export interface Session {
  id: string;
  text: string;
  createdAt: number;
  lastActivity: number;
}

export interface SessionStoreOptions {
  maxSessions: number;
  idleTtlMs: number;
}

const CODE_ATTEMPTS = 50;

export class SessionStore {
  private sessions = new Map<string, Session>();

  constructor(private options: SessionStoreOptions) {}

  // Returns undefined when the store is full or no free code was found.
  create(): Session | undefined {
    if (this.sessions.size >= this.options.maxSessions) return undefined;
    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
      const id = String(randomInt(0, 10_000)).padStart(4, "0");
      if (this.sessions.has(id)) continue;
      const now = Date.now();
      const session: Session = { id, text: "", createdAt: now, lastActivity: now };
      this.sessions.set(id, session);
      return session;
    }
    return undefined;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  setText(id: string, text: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.text = text;
    session.lastActivity = Date.now();
  }

  touch(id: string): void {
    const session = this.sessions.get(id);
    if (session) session.lastActivity = Date.now();
  }

  // Delete sessions idle longer than the TTL that nobody is connected to.
  sweep(isInUse: (id: string) => boolean, now = Date.now()): number {
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if (now - session.lastActivity > this.options.idleTtlMs && !isInUse(id)) {
        this.sessions.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
}
