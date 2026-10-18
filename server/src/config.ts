function num(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// Every limit can be overridden with an environment variable.
export const config = {
  port: num("PORT", 3001),
  maxSessions: num("MAX_SESSIONS", 5000),
  idleTtlMs: num("SESSION_IDLE_MINUTES", 30) * 60_000,
  maxClientsPerRoom: num("MAX_CLIENTS_PER_ROOM", 20),
  maxTextLength: 1_000_000,
  createLimitPerMin: num("CREATE_LIMIT_PER_MIN", 10),
  lookupLimitPerMin: num("LOOKUP_LIMIT_PER_MIN", 30),
  missLimitPerMin: num("MISS_LIMIT_PER_MIN", 300),
  sweepIntervalMs: num("SWEEP_INTERVAL_MS", 60_000),
};
