import type { WebSocket } from "ws";

export class RoomManager {
  private rooms = new Map<string, Set<WebSocket>>();

  join(sessionId: string, client: WebSocket): void {
    let room = this.rooms.get(sessionId);
    if (!room) {
      room = new Set();
      this.rooms.set(sessionId, room);
    }
    room.add(client);
  }

  leave(sessionId: string, client: WebSocket): void {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    room.delete(client);
    if (room.size === 0) this.rooms.delete(sessionId);
  }

  count(sessionId: string): number {
    return this.rooms.get(sessionId)?.size ?? 0;
  }

  // Send to everyone in the room except the sender.
  broadcast(sessionId: string, sender: WebSocket, data: string): void {
    for (const client of this.rooms.get(sessionId) ?? []) {
      if (client !== sender && client.readyState === client.OPEN) {
        client.send(data);
      }
    }
  }
}
