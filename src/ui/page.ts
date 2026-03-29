export const APP_PAGE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Local Agentic RAG UI</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }
      body {
        margin: 0;
        background: #f5f7fa;
        color: #1f2937;
      }
      .layout {
        display: grid;
        grid-template-columns: 320px 1fr;
        min-height: 100vh;
      }
      .sidebar {
        border-right: 1px solid #d1d5db;
        background: #ffffff;
        padding: 16px;
      }
      .main {
        padding: 16px;
        display: grid;
        gap: 16px;
      }
      .card {
        background: #ffffff;
        border: 1px solid #d1d5db;
        border-radius: 8px;
        padding: 14px;
      }
      h1, h2, h3 {
        margin: 0 0 12px;
      }
      h1 {
        font-size: 18px;
      }
      h2 {
        font-size: 16px;
      }
      h3 {
        font-size: 14px;
      }
      .row {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      input[type="text"], textarea, select {
        width: 100%;
        border: 1px solid #cbd5e1;
        border-radius: 6px;
        padding: 8px;
        font: inherit;
        box-sizing: border-box;
      }
      textarea {
        min-height: 100px;
      }
      button {
        border: none;
        border-radius: 6px;
        background: #2563eb;
        color: #fff;
        padding: 8px 12px;
        cursor: pointer;
      }
      button.secondary {
        background: #475569;
      }
      button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .history-list, .doc-list {
        display: grid;
        gap: 8px;
        max-height: 75vh;
        overflow: auto;
      }
      .history-item, .doc-item {
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        padding: 8px;
        background: #f8fafc;
      }
      .history-item.active {
        border-color: #2563eb;
        background: #eff6ff;
      }
      .chat-thread {
        max-height: 420px;
        overflow: auto;
        display: grid;
        gap: 8px;
      }
      .msg {
        padding: 8px;
        border-radius: 6px;
        border: 1px solid #e5e7eb;
        white-space: pre-wrap;
      }
      .msg.user {
        background: #eef2ff;
      }
      .msg.assistant {
        background: #f8fafc;
      }
      .sources {
        margin-top: 8px;
        border-top: 1px solid #e2e8f0;
        padding-top: 8px;
      }
      .sources-title {
        font-size: 12px;
        color: #475569;
        margin-bottom: 6px;
      }
      .source-item {
        border: 1px solid #e5e7eb;
        border-radius: 6px;
        background: #ffffff;
        padding: 6px;
        margin-bottom: 6px;
      }
      .source-actions {
        margin-top: 4px;
        display: flex;
        gap: 6px;
      }
      .source-actions a {
        color: #1d4ed8;
        text-decoration: none;
        font-size: 12px;
      }
      .source-actions a:hover {
        text-decoration: underline;
      }
      .muted {
        font-size: 12px;
        color: #64748b;
      }
      .error {
        color: #b91c1c;
      }
      .ok {
        color: #166534;
      }
      .split {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      @media (max-width: 980px) {
        .layout {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="layout">
      <aside class="sidebar">
        <h1>Chat History</h1>
        <div class="row" style="margin-bottom: 8px">
          <button id="newSessionBtn" class="secondary">Start New Chat</button>
          <button id="refreshHistoryBtn" class="secondary">Refresh</button>
        </div>
        <div id="historyList" class="history-list"></div>
      </aside>
      <main class="main">
        <section class="card">
          <h2>Vectorize Folder</h2>
          <div class="row">
            <input id="folderPath" type="text" placeholder="/absolute/path/to/folder" />
            <button id="vectorizeBtn">Vectorize</button>
          </div>
          <div class="muted" style="margin-top: 8px">
            Use an absolute path on this machine (server-side indexing runs locally).
          </div>
          <div id="ingestStatus" class="muted" style="margin-top: 8px"></div>
        </section>

        <section class="card">
          <h2>Vectorized Documents and Folders</h2>
          <div class="split">
            <div>
              <h3>Folders</h3>
              <div id="folderList" class="doc-list"></div>
            </div>
            <div>
              <h3>Documents</h3>
              <div id="docList" class="doc-list"></div>
            </div>
          </div>
        </section>

        <section class="card">
          <h2>Ask a Question</h2>
          <div class="row" style="margin-bottom: 8px">
            <label class="row" style="gap: 6px">
              <input id="followupMode" type="checkbox" checked />
              Follow-up mode (use selected chat context)
            </label>
          </div>
          <textarea id="questionInput" placeholder="Ask your question"></textarea>
          <div class="row" style="margin-top: 8px">
            <button id="askBtn">Ask</button>
          </div>
          <div id="chatStatus" class="muted" style="margin-top: 8px"></div>
          <div id="chatThread" class="chat-thread" style="margin-top: 12px"></div>
        </section>
      </main>
    </div>

    <script>
      const state = {
        selectedSessionId: null,
        sessions: []
      };

      const historyListEl = document.getElementById("historyList");
      const folderListEl = document.getElementById("folderList");
      const docListEl = document.getElementById("docList");
      const ingestStatusEl = document.getElementById("ingestStatus");
      const chatStatusEl = document.getElementById("chatStatus");
      const chatThreadEl = document.getElementById("chatThread");
      const folderPathEl = document.getElementById("folderPath");
      const questionInputEl = document.getElementById("questionInput");
      const followupModeEl = document.getElementById("followupMode");

      async function fetchJson(url, options) {
        const res = await fetch(url, options);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (typeof data.error === "string") {
            throw new Error(data.error);
          }
          if (data.error && typeof data.error === "object") {
            try {
              throw new Error(JSON.stringify(data.error));
            } catch {
              throw new Error("Request failed");
            }
          }
          throw new Error("Request failed");
        }
        return data;
      }

      function renderHistory() {
        historyListEl.innerHTML = "";
        if (state.sessions.length === 0) {
          historyListEl.innerHTML = '<div class="muted">No chat history yet.</div>';
          return;
        }
        for (const session of state.sessions) {
          const item = document.createElement("button");
          item.className = "history-item" + (session.id === state.selectedSessionId ? " active" : "");
          item.style.textAlign = "left";
          item.innerHTML = '<div><strong>' + new Date(session.updatedAt).toLocaleString() + "</strong></div>"
            + '<div class="muted">Messages: ' + session.messageCount + "</div>";
          item.onclick = async () => {
            state.selectedSessionId = session.id;
            renderHistory();
            await loadSession(session.id);
          };
          historyListEl.appendChild(item);
        }
      }

      function renderThread(messages) {
        chatThreadEl.innerHTML = "";
        if (!messages || messages.length === 0) {
          chatThreadEl.innerHTML = '<div class="muted">No messages yet.</div>';
          return;
        }
        for (const message of messages) {
          const item = document.createElement("div");
          item.className = "msg " + message.role;
          const text = document.createElement("div");
          text.textContent = (message.role === "user" ? "User: " : "Assistant: ") + message.content;
          item.appendChild(text);

          if (message.role === "assistant" && Array.isArray(message.sources) && message.sources.length > 0) {
            const sourcesWrap = document.createElement("div");
            sourcesWrap.className = "sources";

            const title = document.createElement("div");
            title.className = "sources-title";
            title.textContent = "Sources";
            sourcesWrap.appendChild(title);

            for (const source of message.sources) {
              const sourceItem = document.createElement("div");
              sourceItem.className = "source-item";

              const name = source.documentName || source.title || "source";
              const chapter = source.chapterPath ? " | Chapter: " + source.chapterPath : "";
              const page =
                typeof source.pageStart === "number"
                  ? source.pageStart === source.pageEnd || typeof source.pageEnd !== "number"
                    ? " | Page: " + source.pageStart
                    : " | Pages: " + source.pageStart + "-" + source.pageEnd
                  : "";
              const confidence = typeof source.score === "number" ? " | score: " + source.score.toFixed(3) : "";

              const meta = document.createElement("div");
              meta.className = "muted";
              meta.textContent = name + chapter + page + confidence;
              sourceItem.appendChild(meta);

              if (typeof source.documentPath === "string" && source.documentPath.length > 0) {
                const actions = document.createElement("div");
                actions.className = "source-actions";

                const openLink = document.createElement("a");
                openLink.target = "_blank";
                openLink.rel = "noopener noreferrer";
                openLink.href = "/api/document?path=" + encodeURIComponent(source.documentPath);
                openLink.textContent = "Open";
                actions.appendChild(openLink);

                const downloadLink = document.createElement("a");
                downloadLink.target = "_blank";
                downloadLink.rel = "noopener noreferrer";
                downloadLink.href = "/api/document?path=" + encodeURIComponent(source.documentPath) + "&download=1";
                downloadLink.textContent = "Download";
                actions.appendChild(downloadLink);

                sourceItem.appendChild(actions);
              }

              sourcesWrap.appendChild(sourceItem);
            }

            item.appendChild(sourcesWrap);
          }
          chatThreadEl.appendChild(item);
        }
      }

      function renderVectorized(data) {
        folderListEl.innerHTML = "";
        docListEl.innerHTML = "";

        if (!data.folders || data.folders.length === 0) {
          folderListEl.innerHTML = '<div class="muted">No folders tracked.</div>';
        } else {
          for (const folder of data.folders) {
            const el = document.createElement("div");
            el.className = "doc-item";
            el.innerHTML = '<div>' + folder.path + '</div><div class="muted">Documents: ' + folder.documentCount + "</div>";
            folderListEl.appendChild(el);
          }
        }

        if (!data.documents || data.documents.length === 0) {
          docListEl.innerHTML = '<div class="muted">No documents tracked.</div>';
        } else {
          for (const doc of data.documents) {
            const el = document.createElement("div");
            el.className = "doc-item";
            el.innerHTML = '<div>' + doc.path + '</div><div class="muted">Chunks: ' + doc.chunkCount + "</div>";
            docListEl.appendChild(el);
          }
        }
      }

      async function refreshVectorized() {
        const data = await fetchJson("/api/vectorized");
        renderVectorized(data);
      }

      async function refreshHistory() {
        const data = await fetchJson("/api/history");
        state.sessions = data.sessions;
        if (!state.selectedSessionId && data.sessions.length > 0) {
          state.selectedSessionId = data.sessions[0].id;
        }
        renderHistory();
        if (state.selectedSessionId) {
          await loadSession(state.selectedSessionId);
        } else {
          renderThread([]);
        }
      }

      async function loadSession(sessionId) {
        const data = await fetchJson("/api/history/" + encodeURIComponent(sessionId));
        renderThread(data.session.messages);
      }

      async function vectorizeFolder() {
        ingestStatusEl.className = "muted";
        ingestStatusEl.textContent = "Vectorization in progress...";
        try {
          const data = await fetchJson("/api/ingest", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ folderPath: folderPathEl.value.trim() })
          });
          ingestStatusEl.className = "ok";
          ingestStatusEl.textContent =
            "Done. Changed docs: " + data.summary.changedDocs +
            ", skipped: " + data.summary.skippedUnchanged +
            ", chunks upserted: " + data.summary.upsertedChunks;
          await refreshVectorized();
        } catch (error) {
          ingestStatusEl.className = "error";
          ingestStatusEl.textContent = error.message || "Vectorization failed";
        }
      }

      async function askQuestion() {
        const query = questionInputEl.value.trim();
        if (!query) {
          return;
        }

        chatStatusEl.className = "muted";
        chatStatusEl.textContent = "Thinking...";
        try {
          const payload = {
            query,
            followUp: Boolean(followupModeEl.checked)
          };
          if (typeof state.selectedSessionId === "string" && state.selectedSessionId.length > 0) {
            payload.sessionId = state.selectedSessionId;
          }

          const data = await fetchJson("/api/chat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload)
          });
          state.selectedSessionId = data.session.id;
          questionInputEl.value = "";
          chatStatusEl.className = "ok";
          chatStatusEl.textContent = "Answer ready.";
          await refreshHistory();
          renderThread(data.session.messages);
        } catch (error) {
          chatStatusEl.className = "error";
          chatStatusEl.textContent = error.message || "Chat failed";
        }
      }

      document.getElementById("vectorizeBtn").onclick = vectorizeFolder;
      document.getElementById("askBtn").onclick = askQuestion;
      document.getElementById("refreshHistoryBtn").onclick = refreshHistory;
      document.getElementById("newSessionBtn").onclick = async () => {
        state.selectedSessionId = null;
        renderThread([]);
        renderHistory();
        chatStatusEl.className = "muted";
        chatStatusEl.textContent = "New chat mode enabled.";
      };

      refreshVectorized().catch((err) => {
        ingestStatusEl.className = "error";
        ingestStatusEl.textContent = err.message || "Failed to load vectorized list";
      });
      refreshHistory().catch((err) => {
        chatStatusEl.className = "error";
        chatStatusEl.textContent = err.message || "Failed to load history";
      });
    </script>
  </body>
</html>
`;
