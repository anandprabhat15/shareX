import { useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "full";

interface Props {
  sessionId: string;
  language: string;
  onStatusChange: (status: ConnectionStatus) => void;
  onNotice: (message: string) => void;
}

type EditorInstance = Parameters<OnMount>[0];

const SEND_DEBOUNCE_MS = 100;
const RECONNECT_DELAY_MS = 1000;

// In dev the Vite proxy makes ws same-origin; in production set VITE_WS_URL (e.g. wss://api.example.com).
function wsUrl(sessionId: string): string {
  const base =
    import.meta.env.VITE_WS_URL ??
    `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
  return `${base}/ws/${sessionId}`;
}

export default function CollabEditor({ sessionId, language, onStatusChange, onNotice }: Props) {
  const editorRef = useRef<EditorInstance | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const pendingTextRef = useRef<string | null>(null); // text that arrived before the editor mounted
  const applyingRemoteRef = useRef(false); // true while we write remote text into the editor
  const sendTimerRef = useRef<number | undefined>(undefined);

  function applyRemoteText(text: string) {
    const editor = editorRef.current;
    if (!editor) {
      pendingTextRef.current = text;
      return;
    }
    if (editor.getValue() === text) return;
    const selection = editor.getSelection();
    applyingRemoteRef.current = true;
    editor.setValue(text);
    if (selection) editor.setSelection(selection); // keep the local cursor where it was
    applyingRemoteRef.current = false;
  }

  useEffect(() => {
    let disposed = false;
    let roomFull = false; // the server closes full rooms on purpose, so do not reconnect
    let reconnectTimer: number | undefined;

    function connect(isRetry: boolean) {
      onStatusChange(isRetry ? "reconnecting" : "connecting");
      const ws = new WebSocket(wsUrl(sessionId));
      socketRef.current = ws;

      ws.onopen = () => onStatusChange("connected");
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if ((msg.type === "init" || msg.type === "update") && typeof msg.text === "string") {
            applyRemoteText(msg.text);
          } else if (msg.type === "error" && msg.code === "too-large") {
            onNotice(`Document too large (max ${Number(msg.max).toLocaleString()} characters). Your last change was not shared.`);
          } else if (msg.type === "error" && msg.code === "room-full") {
            roomFull = true;
            onStatusChange("full");
          }
        } catch {
          // ignore malformed messages
        }
      };
      ws.onclose = () => {
        if (disposed || roomFull) return;
        onStatusChange("reconnecting");
        reconnectTimer = window.setTimeout(() => connect(true), RECONNECT_DELAY_MS);
      };
    }

    connect(false);
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(sendTimerRef.current);
      socketRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const handleMount: OnMount = (editor) => {
    editorRef.current = editor;
    if (pendingTextRef.current !== null) {
      applyRemoteText(pendingTextRef.current);
      pendingTextRef.current = null;
    }
  };

  function handleChange(value: string | undefined) {
    if (applyingRemoteRef.current) return; // change came from the server, don't echo it back
    window.clearTimeout(sendTimerRef.current);
    sendTimerRef.current = window.setTimeout(() => {
      const ws = socketRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "update", text: value ?? "" }));
      }
    }, SEND_DEBOUNCE_MS);
  }

  return (
    <Editor
      height="100%"
      theme="vs-dark"
      language={language}
      onMount={handleMount}
      onChange={handleChange}
      options={{ minimap: { enabled: false }, fontSize: 14 }}
    />
  );
}
