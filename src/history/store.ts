import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const HISTORY_PATH = "./logs/chat-history.json";
const MAX_SESSIONS = 100;

export interface SourceReference {
  source: "internal" | "web";
  documentName?: string;
  documentPath?: string;
  chapterPath?: string;
  pageStart?: number;
  pageEnd?: number;
  title: string;
  score: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  sources?: SourceReference[];
}

export interface ChatSession {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

interface ChatHistoryFile {
  sessions: ChatSession[];
}

async function readHistoryFile(): Promise<ChatHistoryFile> {
  try {
    const raw = await readFile(HISTORY_PATH, "utf8");
    const parsed = JSON.parse(raw) as ChatHistoryFile;
    if (!parsed || !Array.isArray(parsed.sessions)) {
      return { sessions: [] };
    }
    return parsed;
  } catch {
    return { sessions: [] };
  }
}

async function writeHistoryFile(data: ChatHistoryFile): Promise<void> {
  await mkdir("./logs", { recursive: true });
  await writeFile(HISTORY_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function trimOldSessions(sessions: ChatSession[]): ChatSession[] {
  if (sessions.length <= MAX_SESSIONS) {
    return sessions;
  }
  return sessions
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, MAX_SESSIONS);
}

export async function listChatSessions(): Promise<ChatSession[]> {
  const history = await readHistoryFile();
  return history.sessions.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getChatSession(sessionId: string): Promise<ChatSession | null> {
  const history = await readHistoryFile();
  return history.sessions.find((session) => session.id === sessionId) ?? null;
}

export async function appendChatTurn(
  input: { sessionId?: string; userMessage: string; assistantMessage: string; assistantSources?: SourceReference[] }
): Promise<ChatSession> {
  const history = await readHistoryFile();
  const now = new Date().toISOString();
  const sessionId = input.sessionId ?? randomUUID();
  const existing = history.sessions.find((session) => session.id === sessionId);
  const session: ChatSession = existing ?? {
    id: sessionId,
    createdAt: now,
    updatedAt: now,
    messages: []
  };

  session.messages.push(
    { role: "user", content: input.userMessage, createdAt: now },
    {
      role: "assistant",
      content: input.assistantMessage,
      createdAt: now,
      sources: input.assistantSources
    }
  );
  session.updatedAt = now;

  const nextSessions = history.sessions.filter((item) => item.id !== session.id);
  nextSessions.push(session);
  const cleaned = trimOldSessions(nextSessions);
  await writeHistoryFile({ sessions: cleaned });
  return session;
}

export function buildFollowupQueryFromSession(session: ChatSession, userQuery: string): string {
  const lastTurns = session.messages.slice(-8);
  const transcript = lastTurns
    .map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`)
    .join("\n");

  return [
    "Use the previous conversation as context for this follow-up question.",
    "Conversation so far:",
    transcript,
    "",
    `Follow-up question: ${userQuery}`
  ].join("\n");
}
