import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Home() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function createSession() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/sessions", { method: "POST" });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const { id } = (await res.json()) as { id: string };
      navigate(`/s/${id}`);
    } catch {
      setError("Could not create a session. Is the server running?");
      setLoading(false);
    }
  }

  return (
    <main className="home">
      <h1>shareX</h1>
      <p>Create a session and share the link.</p>
      <button onClick={createSession} disabled={loading}>
        {loading ? "Creating..." : "New session"}
      </button>
      {error && <p className="error">{error}</p>}
    </main>
  );
}
