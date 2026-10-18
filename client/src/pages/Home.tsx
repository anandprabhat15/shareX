import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";

export default function Home() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");

  async function createSession() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/sessions", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Server returned ${res.status}`);
      }
      const { id } = (await res.json()) as { id: string };
      navigate(`/${id}`);
    } catch (e) {
      setError(e instanceof TypeError ? "Could not reach the server." : (e as Error).message);
      setLoading(false);
    }
  }

  function joinByCode(event: FormEvent) {
    event.preventDefault();
    if (/^\d{4}$/.test(code)) navigate(`/${code}`);
  }

  return (
    <main className="home">
      <h1>shareX</h1>
      <p>Create a session and share the 4-digit code or link.</p>
      <button onClick={createSession} disabled={loading}>
        {loading ? "Creating..." : "New session"}
      </button>
      <p className="or">or join with a code</p>
      <form className="join" onSubmit={joinByCode}>
        <input
          inputMode="numeric"
          maxLength={4}
          placeholder="1234"
          aria-label="4-digit session code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        />
        <button type="submit" disabled={code.length !== 4}>
          Join
        </button>
      </form>
      {error && <p className="error">{error}</p>}
      <p className="hint">Codes are public: anyone with a code can join, so don't paste secrets.</p>
    </main>
  );
}
