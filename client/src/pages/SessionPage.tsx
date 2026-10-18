import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import CollabEditor, { type ConnectionStatus } from "../components/CollabEditor";

const LANGUAGES = ["plaintext", "javascript", "typescript", "python", "java", "cpp", "html", "css", "json", "markdown"];
const NOTICE_MS = 6000;

type Status = "loading" | "ok" | "notfound" | "ratelimited" | "error";

const MESSAGES: Record<Exclude<Status, "loading" | "ok">, string> = {
  notfound: "Session not found. It may have expired or the code is wrong.",
  ratelimited: "Too many attempts. Please wait a minute and try again.",
  error: "Could not reach the server.",
};

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const [status, setStatus] = useState<Status>("loading");
  const [language, setLanguage] = useState("plaintext");
  const [copied, setCopied] = useState(false);
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setStatus("loading");
    fetch(`/api/sessions/${id}`)
      .then((res) =>
        setStatus(res.ok ? "ok" : res.status === 404 ? "notfound" : res.status === 429 ? "ratelimited" : "error"),
      )
      .catch(() => setStatus("error"));
  }, [id]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (status === "loading") return <main className="home"><p>Loading...</p></main>;
  if (status !== "ok") {
    return (
      <main className="home">
        <p className="error">{MESSAGES[status]}</p>
        <Link to="/">Back to home</Link>
      </main>
    );
  }
  if (connection === "full") {
    return (
      <main className="home">
        <p className="error">This session is full. Ask the host to make room, or start a new session.</p>
        <Link to="/">Back to home</Link>
      </main>
    );
  }

  return (
    <div className="session">
      <header>
        <Link to="/" className="brand">shareX</Link>
        <span className="session-code" title="Session code">{id}</span>
        <span className={`status ${connection}`}>{connection}</span>
        <select value={language} onChange={(e) => setLanguage(e.target.value)}>
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <button onClick={copyLink}>{copied ? "Copied!" : "Copy link"}</button>
      </header>
      {notice && <div className="notice" role="alert">{notice}</div>}
      <CollabEditor sessionId={id!} language={language} onStatusChange={setConnection} onNotice={setNotice} />
    </div>
  );
}
