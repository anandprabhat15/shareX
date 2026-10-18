import { nanoid } from "nanoid";

export interface Session {
  id: string;
  text: string;
  createdAt: number;
}

export class SessionStore {
  private sessions = new Map<string, Session>();

  create(): Session {
    const session: Session = { id: nanoid(10), text: "", createdAt: Date.now() };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  setText(id: string, text: string): void {
    const session = this.sessions.get(id);
    if (session) session.text = text;
  }
}
