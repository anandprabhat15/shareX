import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import CollabEditor, { type ConnectionStatus } from "../components/CollabEditor";

const LANGUAGES = ["plaintext", "javascript", "typescript", "python", "java", "cpp", "html", "css", "json", "markdown"];

type Status = "loading" | "ok" | "notfound" | "error";

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const [status, setStatus] = useState<Status>("loading");
  const [language, setLanguage] = useState("plaintext");
  const [copied, setCopied] = useState(false);
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");

  useEffect(() => {
    setStatus("loading");
    fetch(`/api/sessions/${id}`)
      .then((res) => setStatus(res.ok ? "ok" : res.status === 404 ? "notfound" : "error"))
      .catch(() => setStatus("error"));
  }, [id]);

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (status === "loading") return <main className="home"><p>Loading...</p></main>;
  if (status !== "ok") {
    return (
      <main className="home">
        <p className="error">{status === "notfound" ? "Session not found." : "Could not reach the server."}</p>
        <Link to="/">Back to home</Link>
      </main>
    );
  }

  return (
    <div className="session">
      <header>
        <Link to="/" className="brand">CodeShare</Link>
        <span className="session-id">{id}</span>
        <span className={`status ${connection}`}>{connection}</span>
        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <button onClick={copyLink}>{copied ? "Copied!" : "Copy link"}</button>
      </header>
      <CollabEditor sessionId={id!} language={language} onStatusChange={setConnection} />
    </div>
  );
}
