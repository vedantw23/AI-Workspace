const STORAGE_KEY = "ai-workspace:v1";
const DEFAULT_API_URL = "/chat";

const state = {
  theme: "dark",
  chats: [],
  activeChatId: null,
  searchTerm: "",
  pending: false,
  renameTargetId: null,
};

const els = {};
let activeAbortController = null;

function uid(prefix = "id") {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function loadConfig() {
  const meta = document.querySelector('meta[name="api-url"]');
  return (window.__AI_WORKSPACE_CONFIG && window.__AI_WORKSPACE_CONFIG.apiUrl) || meta?.content || DEFAULT_API_URL;
}

function createChat(title = "New chat") {
  return {
    id: uid("chat"),
    title,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    messages: [],
  };
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed && Array.isArray(parsed.chats)) {
        state.theme = parsed.theme === "light" ? "light" : "dark";
        state.chats = parsed.chats;
        state.activeChatId = parsed.activeChatId || parsed.chats[0]?.id || null;

        if (!state.chats.length) {
          const chat = createChat();
          state.chats = [chat];
          state.activeChatId = chat.id;
        }

        if (!state.chats.some((chat) => chat.id === state.activeChatId)) {
          state.activeChatId = state.chats[0].id;
        }

        return;
      }
    } catch (error) {
      console.warn("Failed to parse stored workspace state", error);
    }
  }

  const chat = createChat();
  state.chats = [chat];
  state.activeChatId = chat.id;
}

function persistState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      theme: state.theme,
      chats: state.chats,
      activeChatId: state.activeChatId,
    })
  );
}

function getActiveChat() {
  return state.chats.find((chat) => chat.id === state.activeChatId) || null;
}

function getVisibleChats() {
  const term = state.searchTerm.trim().toLowerCase();
  if (!term) return state.chats;

  return state.chats.filter((chat) => {
    const haystack = `${chat.title} ${chat.messages.map((message) => message.content).join(" ")}`.toLowerCase();
    return haystack.includes(term);
  });
}

function setTheme(theme) {
  state.theme = theme === "light" ? "light" : "dark";
  document.body.dataset.theme = state.theme;
  persistState();
}

function formatTimestamp(iso) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatRelativeDate(iso) {
  const date = new Date(iso);
  const diffDays = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function inlineMarkdown(text) {
  let html = text
    .replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");

  return html.replace(/\n/g, "<br />");
}

function renderCodeBlock(language, code) {
  return `
    <div class="code-block">
      <div class="code-block__bar">
        <span class="code-block__lang">${escapeHtml(language || "text")}</span>
        <button class="message__action" type="button" data-action="copy-code">Copy code</button>
      </div>
      <pre><code>${escapeHtml(code)}</code></pre>
    </div>
  `;
}

function renderMarkdown(text) {
  const segments = [];
  const codePattern = /```([\w-]+)?\n([\s\S]*?)```/g;
  let cursor = 0;
  let match;

  while ((match = codePattern.exec(text)) !== null) {
    const [full, language = "text", code] = match;
    const before = text.slice(cursor, match.index);
    if (before) {
      segments.push(`<div class="message__content">${inlineMarkdown(escapeHtml(before))}</div>`);
    }
    segments.push(renderCodeBlock(language, code));
    cursor = match.index + full.length;
  }

  const tail = text.slice(cursor);
  if (tail) {
    segments.push(`<div class="message__content">${inlineMarkdown(escapeHtml(tail))}</div>`);
  }

  return segments.join("");
}

function summarizeText(text, limit = 92) {
  const compact = String(text || "").replace(/\s+/g, " ").trim();
  if (!compact) return "New chat";
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, limit - 3)}...`;
}

function generateChatTitleFromPrompt(prompt) {
  const words = String(prompt || "")
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);

  if (!words.length) return "New chat";

  return words
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function ensureChatTitle(chat) {
  if (chat.title && chat.title !== "New chat") return;
  const firstUserMessage = chat.messages.find((message) => message.role === "user");
  if (firstUserMessage) {
    chat.title = generateChatTitleFromPrompt(firstUserMessage.content);
  }
}

function touchChat(chat) {
  chat.updatedAt = nowIso();
  ensureChatTitle(chat);
}

function createMessageElement(message) {
  const wrapper = document.createElement("article");
  wrapper.className = `message message--${message.role}`;
  wrapper.dataset.messageId = message.id;

  const bubble = message.pending
    ? `
      <div class="message__bubble">
        <div class="typing" aria-label="Loading response">
          <span></span><span></span><span></span>
        </div>
      </div>
    `
    : `<div class="message__bubble">${renderMarkdown(message.content)}</div>`;

  const actions = message.role === "assistant" && !message.pending
    ? `
      <div class="message__actions">
        <button class="message__action" type="button" data-action="copy-message" data-message-id="${message.id}">
          Copy response
        </button>
        <button class="message__action" type="button" data-action="regenerate" data-message-id="${message.id}">
          Regenerate
        </button>
      </div>
    `
    : "";

  wrapper.innerHTML = `
    ${bubble}
    <div class="message__meta">
      <span>${message.pending ? "Generating..." : formatTimestamp(message.createdAt)}</span>
      ${actions}
    </div>
  `;

  return wrapper;
}

function renderChatList() {
  const chatList = els.chatList;
  const visibleChats = getVisibleChats();
  chatList.innerHTML = "";

  if (!visibleChats.length) {
    const empty = document.createElement("div");
    empty.className = "chat-card";
    empty.innerHTML = `
      <div class="chat-card__top">
        <h3 class="chat-card__title">No conversations found</h3>
      </div>
      <p class="chat-card__preview">Try a different search or create a new chat.</p>
    `;
    chatList.appendChild(empty);
    return;
  }

  visibleChats
    .slice()
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .forEach((chat) => {
      const card = document.createElement("div");
      card.className = `chat-card${chat.id === state.activeChatId ? " is-active" : ""}`;
      card.dataset.chatId = chat.id;

      const previewSource = chat.messages.at(-1)?.content || "No messages yet";

      card.innerHTML = `
        <div class="chat-card__top">
          <h3 class="chat-card__title">${escapeHtml(chat.title || "New chat")}</h3>
          <div class="chat-card__actions">
            <button class="chat-card__action" type="button" data-action="rename-chat" data-chat-id="${chat.id}" aria-label="Rename chat">Rename</button>
            <button class="chat-card__action" type="button" data-action="delete-chat" data-chat-id="${chat.id}" aria-label="Delete chat">Delete</button>
          </div>
        </div>
        <p class="chat-card__preview">${escapeHtml(summarizeText(previewSource, 112))}</p>
        <div class="chat-card__meta">
          <span>${chat.messages.length ? `${chat.messages.length} messages` : "Empty"}</span>
          <span>${formatRelativeDate(chat.updatedAt)}</span>
        </div>
      `;

      chatList.appendChild(card);
    });
}

function renderMessages() {
  const chat = getActiveChat();
  const messagesEl = els.messages;
  const emptyState = els.emptyState;
  const activeTitle = els.activeChatTitle;

  messagesEl.innerHTML = "";

  if (!chat) {
    emptyState.classList.add("is-visible");
    activeTitle.textContent = "Untitled Chat";
    return;
  }

  activeTitle.textContent = chat.title || "Untitled Chat";
  emptyState.classList.toggle("is-visible", chat.messages.length === 0);

  chat.messages.forEach((message) => {
    messagesEl.appendChild(createMessageElement(message));
  });

  if (state.pending) {
    messagesEl.appendChild(
      createMessageElement({
        id: `${chat.id}-pending`,
        role: "assistant",
        pending: true,
        createdAt: nowIso(),
        content: "",
      })
    );
  }
}

function renderAll() {
  document.body.dataset.theme = state.theme;
  renderChatList();
  renderMessages();
  persistState();
  queueMicrotask(() => scrollToBottom(true));
}

function scrollToBottom(force = false) {
  const el = els.messages;
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  if (force || distanceFromBottom < 280) {
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }
}

function openModal(modalEl) {
  modalEl.hidden = false;
}

function closeModal(modalEl) {
  modalEl.hidden = true;
}

function openSettings() {
  openModal(els.settingsModal);
}

function openRenameDialog(chatId) {
  const chat = state.chats.find((item) => item.id === chatId);
  if (!chat) return;

  state.renameTargetId = chatId;
  els.renameInput.value = chat.title || "New chat";
  openModal(els.renameModal);
  els.renameInput.focus();
  els.renameInput.select();
}

function openSidebar() {
  document.body.classList.add("sidebar-open");
  els.sidebarBackdrop.hidden = false;
}

function closeSidebar() {
  document.body.classList.remove("sidebar-open");
  els.sidebarBackdrop.hidden = true;
}

function activateChat(chatId) {
  state.activeChatId = chatId;
  renderAll();
  closeSidebar();
}

function createNewChat() {
  const chat = createChat();
  state.chats.unshift(chat);
  state.activeChatId = chat.id;
  state.searchTerm = "";
  els.chatSearch.value = "";
  renderAll();
}

function deleteChat(chatId) {
  const chat = state.chats.find((item) => item.id === chatId);
  if (!chat) return;

  const confirmed = window.confirm(`Delete "${chat.title || "New chat"}"?`);
  if (!confirmed) return;

  state.chats = state.chats.filter((item) => item.id !== chatId);
  if (!state.chats.length) {
    const next = createChat();
    state.chats = [next];
    state.activeChatId = next.id;
  } else if (state.activeChatId === chatId) {
    state.activeChatId = state.chats[0].id;
  }

  renderAll();
}

function clearActiveChat() {
  const chat = getActiveChat();
  if (!chat || !chat.messages.length) return;

  const confirmed = window.confirm("Clear all messages in this chat?");
  if (!confirmed) return;

  chat.messages = [];
  chat.title = "New chat";
  touchChat(chat);
  renderAll();
}

function resetWorkspace() {
  const confirmed = window.confirm("Reset all local conversations and settings?");
  if (!confirmed) return;

  localStorage.removeItem(STORAGE_KEY);
  state.theme = "dark";
  state.chats = [createChat()];
  state.activeChatId = state.chats[0].id;
  state.searchTerm = "";
  state.pending = false;
  state.renameTargetId = null;
  els.chatSearch.value = "";
  closeModal(els.settingsModal);
  closeModal(els.renameModal);
  renderAll();
  setTheme(state.theme);
}

function renameChat(chatId, title) {
  const chat = state.chats.find((item) => item.id === chatId);
  if (!chat) return;

  chat.title = title.trim() || "New chat";
  touchChat(chat);
  renderAll();
}

function setBusy(busy) {
  state.pending = busy;
  els.connectionStatus.textContent = busy ? "Thinking..." : "Ready";
  els.sendBtn.disabled = busy;
  els.themeToggleBtn.disabled = busy;
  els.modalThemeToggle.disabled = busy;
  renderMessages();
  scrollToBottom(true);
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const fallback = document.createElement("textarea");
  fallback.value = text;
  document.body.appendChild(fallback);
  fallback.select();
  document.execCommand("copy");
  fallback.remove();
}

function lastUserMessageBefore(chat, messageIndex) {
  for (let index = messageIndex - 1; index >= 0; index -= 1) {
    if (chat.messages[index]?.role === "user") {
      return chat.messages[index];
    }
  }
  return null;
}

function buildRequestPayload(chat) {
  return {
    messages: chat.messages
      .filter((message) => !message.pending)
      .map((message) => ({
        role: message.role,
        content: message.content,
      })),
    chat_id: chat.id,
  };
}

async function readAssistantContent(response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const json = await response.json();
    return (
      json.reply ||
      json.response ||
      json.message ||
      json.content ||
      json.text ||
      json.data?.reply ||
      json.data?.content ||
      JSON.stringify(json)
    );
  }

  return response.text();
}

async function requestAssistantReply(chat) {
  const apiUrl = loadConfig();
  activeAbortController?.abort();
  activeAbortController = new AbortController();

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildRequestPayload(chat)),
    signal: activeAbortController.signal,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(errorText || `Request failed with status ${response.status}`);
  }

  const answer = await readAssistantContent(response);
  return typeof answer === "string" ? answer.trim() : String(answer);
}

async function generateAssistantResponse(chat) {
  setBusy(true);

  try {
    const reply = await requestAssistantReply(chat);
    chat.messages.push({
      id: uid("msg"),
      role: "assistant",
      content: reply || "I did not receive a response from the backend.",
      createdAt: nowIso(),
    });
    touchChat(chat);
    renderAll();
  } catch (error) {
    if (error?.name !== "AbortError") {
      chat.messages.push({
        id: uid("msg"),
        role: "assistant",
        content: "I could not reach the backend. Check that the FastAPI route is running and matches the configured API URL.",
        createdAt: nowIso(),
      });
      touchChat(chat);
      renderAll();
    }
  } finally {
    setBusy(false);
  }
}

async function sendMessage(rawText) {
  const chat = getActiveChat();
  if (!chat || state.pending) return;

  const text = rawText.trim();
  if (!text) return;

  chat.messages.push({
    id: uid("msg"),
    role: "user",
    content: text,
    createdAt: nowIso(),
  });
  touchChat(chat);
  state.activeChatId = chat.id;
  renderAll();

  await generateAssistantResponse(chat);
}

async function regenerateFrom(messageId) {
  const chat = getActiveChat();
  if (!chat || state.pending) return;

  const messageIndex = chat.messages.findIndex((message) => message.id === messageId);
  if (messageIndex < 0) return;

  if (!lastUserMessageBefore(chat, messageIndex)) return;

  chat.messages = chat.messages.slice(0, messageIndex);
  touchChat(chat);
  renderAll();

  await generateAssistantResponse(chat);
}

function autoResizeTextarea() {
  const textarea = els.messageInput;
  textarea.style.height = "0px";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 220)}px`;
}

function initElements() {
  els.chatList = document.getElementById("chatList");
  els.messages = document.getElementById("messages");
  els.messageInput = document.getElementById("messageInput");
  els.sendBtn = document.getElementById("sendBtn");
  els.newChatBtn = document.getElementById("newChatBtn");
  els.clearChatBtn = document.getElementById("clearChatBtn");
  els.settingsBtn = document.getElementById("settingsBtn");
  els.themeToggleBtn = document.getElementById("themeToggleBtn");
  els.modalThemeToggle = document.getElementById("modalThemeToggle");
  els.emptyState = document.getElementById("emptyState");
  els.activeChatTitle = document.getElementById("activeChatTitle");
  els.connectionStatus = document.getElementById("connectionStatus");
  els.attachBtn = document.getElementById("attachBtn");
  els.chatSearch = document.getElementById("chatSearch");
  els.settingsModal = document.getElementById("settingsModal");
  els.renameModal = document.getElementById("renameModal");
  els.renameInput = document.getElementById("renameInput");
  els.renameSaveBtn = document.getElementById("renameSaveBtn");
  els.resetStorageBtn = document.getElementById("resetStorageBtn");
  els.sidebarToggle = document.getElementById("sidebarToggle");
  els.sidebarBackdrop = document.getElementById("sidebarBackdrop");
}

function bindEvents() {
  els.newChatBtn.addEventListener("click", createNewChat);
  els.clearChatBtn.addEventListener("click", clearActiveChat);
  els.settingsBtn.addEventListener("click", openSettings);
  els.themeToggleBtn.addEventListener("click", () => setTheme(state.theme === "dark" ? "light" : "dark"));
  els.modalThemeToggle.addEventListener("click", () => setTheme(state.theme === "dark" ? "light" : "dark"));
  els.resetStorageBtn.addEventListener("click", resetWorkspace);
  els.sidebarToggle.addEventListener("click", openSidebar);
  els.sidebarBackdrop.addEventListener("click", closeSidebar);

  els.attachBtn.addEventListener("click", () => {
    els.connectionStatus.textContent = "Attachment UI only";
    setTimeout(() => {
      if (!state.pending) {
        els.connectionStatus.textContent = "Ready";
      }
    }, 1200);
  });

  els.chatSearch.addEventListener("input", (event) => {
    state.searchTerm = event.target.value;
    renderChatList();
  });

  els.messageInput.addEventListener("input", autoResizeTextarea);
  els.messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      const text = els.messageInput.value;
      els.messageInput.value = "";
      autoResizeTextarea();
      sendMessage(text);
    }
  });

  els.sendBtn.addEventListener("click", () => {
    const text = els.messageInput.value;
    els.messageInput.value = "";
    autoResizeTextarea();
    sendMessage(text);
  });

  els.chatList.addEventListener("click", (event) => {
    const actionButton = event.target.closest("[data-action]");
    const card = event.target.closest(".chat-card");

    if (actionButton?.dataset.action === "rename-chat") {
      openRenameDialog(actionButton.dataset.chatId);
      return;
    }

    if (actionButton?.dataset.action === "delete-chat") {
      deleteChat(actionButton.dataset.chatId);
      return;
    }

    if (card?.dataset.chatId) {
      activateChat(card.dataset.chatId);
    }
  });

  document.addEventListener("click", (event) => {
    const promptButton = event.target.closest("[data-prompt]");
    if (promptButton) {
      els.messageInput.value = promptButton.dataset.prompt;
      autoResizeTextarea();
      els.messageInput.focus();
    }

    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;

    if (actionButton.dataset.action === "copy-message") {
      const chat = getActiveChat();
      const message = chat?.messages.find((item) => item.id === actionButton.dataset.messageId);
      if (message) {
        copyText(message.content).then(() => {
          actionButton.textContent = "Copied";
          setTimeout(() => {
            actionButton.textContent = "Copy response";
          }, 1200);
        });
      }
      return;
    }

    if (actionButton.dataset.action === "copy-code") {
      const codeBlock = actionButton.closest(".code-block");
      const code = codeBlock?.querySelector("code")?.textContent || "";
      copyText(code).then(() => {
        actionButton.textContent = "Copied";
        setTimeout(() => {
          actionButton.textContent = "Copy code";
        }, 1200);
      });
      return;
    }

    if (actionButton.dataset.action === "regenerate") {
      regenerateFrom(actionButton.dataset.messageId);
    }
  });

  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", () => {
      const modal = button.dataset.closeModal === "settings" ? els.settingsModal : els.renameModal;
      closeModal(modal);
      state.renameTargetId = null;
    });
  });

  els.renameSaveBtn.addEventListener("click", () => {
    if (state.renameTargetId) {
      renameChat(state.renameTargetId, els.renameInput.value);
    }
    closeModal(els.renameModal);
    state.renameTargetId = null;
  });

  els.renameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      els.renameSaveBtn.click();
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeModal(els.settingsModal);
      closeModal(els.renameModal);
      closeSidebar();
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
      event.preventDefault();
      createNewChat();
    }
  });

}

function boot() {
  initElements();
  loadState();
  setTheme(state.theme);
  bindEvents();
  autoResizeTextarea();
  renderAll();
}

boot();
