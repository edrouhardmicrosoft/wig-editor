"use client";

import {
  SandpackCodeEditor,
  SandpackPreview,
  SandpackProvider,
  useSandpack,
} from "@codesandbox/sandpack-react";
import {
  ChevronsLeft,
  ChevronsRight,
  CornerUpLeft,
  Send,
  Settings,
  X,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const APP_CODE = `export default function App() {
  return (
    <div style={{ padding: 16, fontFamily: "system-ui" }}>
      <button
        data-wig-select="button"
        style={{
          padding: "10px 14px",
          borderRadius: 10,
          border: "1px solid #ddd",
          background: "#111",
          color: "white",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Hello Sandpack
      </button>
    </div>
  )
}
`;

function generateAppCode(styles: { backgroundColor: string; color: string; borderRadiusPx: number }) {
  return `export default function App() {
  return (
    <div style={{ padding: 16, fontFamily: "system-ui" }}>
      <button
        data-wig-select="button"
        style={{
          padding: "10px 14px",
          borderRadius: ${styles.borderRadiusPx},
          border: "1px solid #ddd",
          background: "${styles.backgroundColor}",
          color: "${styles.color}",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Hello Sandpack
      </button>
    </div>
  )
}
`;
}

type SidebarSide = "left" | "right";

type SidebarView = "chat" | "editor";

type AzureConfig = {
  endpoint: string;
  apiKey: string;
  deploymentName: string;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
};

type SelectedElement = {
  kind: "button";
  label: string;
  styles: {
    backgroundColor: string;
    color: string;
    borderRadiusPx: number;
  };
};

type LocalStorageState<T> = {
  value: T;
  setValue: (next: T | ((prev: T) => T)) => void;
  hydrated: boolean;
};

function useLocalStorageState<T>(key: string, initialValue: T): LocalStorageState<T> {
  const [value, setValue] = useState<T>(initialValue);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw != null) {
        try {
          setValue(JSON.parse(raw) as T);
        } catch {
          // Corrupted localStorage value; use initial value instead
        }
      }
    } finally {
      setHydrated(true);
    }
  }, [key]);

  const setAndPersist = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          // localStorage may be unavailable (e.g., private browsing)
        }
        return resolved;
      });
    },
    [key],
  );

  return { value, setValue: setAndPersist, hydrated };
}

function SettingsModal(props: {
  config: AzureConfig;
  onSave: (config: AzureConfig) => void;
  onClose: () => void;
}) {
  const { config, onSave, onClose } = props;

  const [endpoint, setEndpoint] = useState(config.endpoint);
  const [apiKey, setApiKey] = useState(config.apiKey);
  const [deploymentName, setDeploymentName] = useState(config.deploymentName);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({ endpoint: endpoint.trim(), apiKey: apiKey.trim(), deploymentName: deploymentName.trim() });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-[#343434] bg-[#1c1c1c] shadow-xl">
        <div className="flex items-center justify-between border-b border-[#343434] px-4 py-3">
          <h2 className="text-sm font-semibold text-[#e0e0e0]">Azure OpenAI Settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="grid size-7 place-items-center rounded-md text-[#808080] hover:bg-[#2a2a2a] hover:text-[#e0e0e0]"
            aria-label="Close settings"
          >
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="endpoint" className="text-xs font-medium text-[#808080]">
              Endpoint
            </label>
            <input
              id="endpoint"
              type="url"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://your-resource.openai.azure.com"
              className="rounded-lg border border-[#343434] bg-[#252525] px-3 py-2 text-sm text-[#e0e0e0] placeholder:text-[#606060] focus:border-[#505050] focus:outline-none focus:ring-1 focus:ring-[#505050]"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="apiKey" className="text-xs font-medium text-[#808080]">
              API Key
            </label>
            <input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your Azure OpenAI API key"
              className="rounded-lg border border-[#343434] bg-[#252525] px-3 py-2 text-sm text-[#e0e0e0] placeholder:text-[#606060] focus:border-[#505050] focus:outline-none focus:ring-1 focus:ring-[#505050]"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="deploymentName" className="text-xs font-medium text-[#808080]">
              Deployment Name
            </label>
            <input
              id="deploymentName"
              type="text"
              value={deploymentName}
              onChange={(e) => setDeploymentName(e.target.value)}
              placeholder="gpt-4o-mini"
              className="rounded-lg border border-[#343434] bg-[#252525] px-3 py-2 text-sm text-[#e0e0e0] placeholder:text-[#606060] focus:border-[#505050] focus:outline-none focus:ring-1 focus:ring-[#505050]"
            />
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-[#343434] bg-[#252525] px-3 py-2 text-sm font-medium text-[#e0e0e0] hover:bg-[#2a2a2a]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 rounded-lg bg-[#0078d4] px-3 py-2 text-sm font-medium text-white hover:bg-[#106ebe]"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function MessageBubble(props: { message: ChatMessage }) {
  const { message } = props;
  const isUser = message.role === "user";

  return (
    <div className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
      <span className="text-[10px] font-medium text-[#606060] px-1">
        {isUser ? "You" : "Wigglebot"}
      </span>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? "bg-[#0078d4] text-white rounded-br-md"
            : "bg-[#343434] text-[#e0e0e0] rounded-bl-md"
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}

function ChatSidebar(props: {
  sandpack: ReturnType<typeof useSandpack>["sandpack"];
  azureConfig: AzureConfig;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const { sandpack, azureConfig, textareaRef } = props;

  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      const maxHeight = 120;
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    }
  }, [textareaRef]);

  useEffect(() => {
    adjustTextareaHeight();
  }, [prompt, adjustTextareaHeight]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();

    const nextPrompt = prompt.trim();
    if (!nextPrompt || loading) return;

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: nextPrompt,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setPrompt("");
    setLoading(true);
    setError(null);
    setPrUrl(null);

    const currentCode = sandpack.files["/App.js"].code;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: currentCode,
          prompt: nextPrompt,
          azure: azureConfig.endpoint && azureConfig.apiKey ? azureConfig : undefined,
        }),
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      const { code } = (await res.json()) as { code: string };
      sandpack.updateFile("/App.js", code);

      const assistantMessage: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: "Done! I've updated the component.",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "An unexpected error occurred.";

      setError(message);
      const errorMessage: ChatMessage = {
        id: `assistant-error-${Date.now()}`,
        role: "assistant",
        content: `Error: ${message}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handlePush = async () => {
    setPushing(true);
    setError(null);
    setPrUrl(null);

    const currentCode = sandpack.files["/App.js"].code;

    try {
      const commitRes = await fetch("/api/github/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: "App.js",
          content: currentCode,
          message: "Update App.js via WIG editor",
        }),
      });

      if (!commitRes.ok) {
        throw new Error(await commitRes.text());
      }

      const { branchName } = (await commitRes.json()) as { branchName: string };

      const prRes = await fetch("/api/github/pr", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchName,
          title: "WIG: Update App.js",
          body: "PR created from WIG editor.",
        }),
      });

      if (!prRes.ok) {
        throw new Error(await prRes.text());
      }

      const { url } = (await prRes.json()) as { url: string };
      setPrUrl(url);

      const prMessage: ChatMessage = {
        id: `assistant-pr-${Date.now()}`,
        role: "assistant",
        content: `PR created: ${url}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, prMessage]);
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "An unexpected error occurred.";

      setError(message);
    } finally {
      setPushing(false);
    }
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <div className="flex h-full flex-col bg-[#1c1c1c]">
      <div className="flex items-center justify-between border-b border-[#343434] px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="grid size-6 place-items-center rounded-md bg-[#0078d4] text-white">
            <Send size={12} aria-hidden="true" />
          </div>
          <span className="text-sm font-semibold text-[#e0e0e0]">Chat</span>
        </div>
        <button
          type="button"
          onClick={handlePush}
          disabled={loading || pushing}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#343434] bg-[#252525] px-2 py-1 text-xs font-medium text-[#e0e0e0] transition-colors hover:bg-[#2a2a2a] disabled:opacity-50"
          title="Push to GitHub"
        >
          <Upload size={12} />
          {pushing ? "Pushing…" : "Push"}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <div className="text-center text-[#606060]">
              <div className="text-sm">No messages yet</div>
              <div className="text-xs mt-1">Start chatting to edit the component</div>
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {loading && (
          <div className="flex flex-col gap-1 items-start">
            <span className="text-[10px] font-medium text-[#606060] px-1">Wigglebot</span>
            <div className="bg-[#343434] text-[#808080] rounded-2xl rounded-bl-md px-3 py-2 text-sm">
              Thinking…
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {error && !messages.some((m) => m.content.includes(error)) && (
        <div className="mx-3 mb-2 rounded-lg border border-red-900/50 bg-red-950/30 p-2 text-xs text-red-400">
          {error}
        </div>
      )}

      {prUrl && (
        <div className="mx-3 mb-2 rounded-lg border border-[#343434] bg-[#252525] p-2 text-xs">
          <span className="text-[#808080]">PR: </span>
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#0078d4] hover:underline break-all"
          >
            {prUrl}
          </a>
        </div>
      )}

      <form onSubmit={handleSubmit} className="border-t border-[#343434] p-3">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleTextareaKeyDown}
            placeholder="Describe changes… (Cmd/Ctrl+Enter)"
            rows={1}
            className="flex-1 resize-none rounded-lg border border-[#343434] bg-[#252525] px-3 py-2 text-sm text-[#e0e0e0] placeholder:text-[#606060] focus:border-[#505050] focus:outline-none focus:ring-1 focus:ring-[#505050]"
            style={{ minHeight: "40px", maxHeight: "120px" }}
          />
          <button
            type="submit"
            disabled={loading || !prompt.trim()}
            className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#0078d4] text-white transition-colors hover:bg-[#106ebe] disabled:opacity-50"
            aria-label="Send message"
          >
            <Send size={16} />
          </button>
        </div>
        <div className="mt-2 text-[10px] text-[#606060]">
          <span className="font-medium text-[#808080]">Cmd/Ctrl+B</span> toggle
          <span className="mx-1">•</span>
          <span className="font-medium text-[#808080]">Cmd/Ctrl+Shift+B</span> swap
        </div>
      </form>
    </div>
  );
}

function PlaygroundShell() {
  const { sandpack } = useSandpack();

  const [selectedElement, setSelectedElement] = useState<SelectedElement | null>(null);

  const sidebarOpen = useLocalStorageState<boolean>("wig.sidebar.open", true);
  const sidebarSide = useLocalStorageState<SidebarSide>("wig.sidebar.side", "right");
  const sidebarView = useLocalStorageState<SidebarView>("wig.sidebar.view", "chat");
  const azureConfig = useLocalStorageState<AzureConfig>("wig.azure", {
    endpoint: "",
    apiKey: "",
    deploymentName: "gpt-4o-mini",
  });

  const hydrated = sidebarOpen.hydrated && sidebarSide.hydrated && sidebarView.hydrated && azureConfig.hydrated;

  const [showSettings, setShowSettings] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const toggleSidebar = useCallback(() => {
    sidebarOpen.setValue((v) => !v);
  }, [sidebarOpen]);

  const swapSidebarSide = useCallback(() => {
    sidebarSide.setValue((v) => (v === "left" ? "right" : "left"));
  }, [sidebarSide]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedElement(null);
        return;
      }

      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== "b") return;

      e.preventDefault();
      if (e.shiftKey) {
        swapSidebarSide();
      } else {
        sidebarOpen.setValue((prev) => {
          const next = !prev;
          if (next) {
            setTimeout(() => textareaRef.current?.focus(), 50);
          }
          return next;
        });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [swapSidebarSide, sidebarOpen]);

  useEffect(() => {
    if (selectedElement == null) return;
    sidebarOpen.setValue(true);
    sidebarView.setValue("editor");
  }, [selectedElement, sidebarOpen, sidebarView]);

  useEffect(() => {
    if (selectedElement == null) return;
    sandpack.updateFile("/App.js", generateAppCode(selectedElement.styles));
  }, [selectedElement, sandpack]);

  const side: SidebarSide = sidebarSide.value;
  const isOpen = sidebarOpen.value;

  const rootFlexClass = useMemo(() => {
    return side === "right" ? "flex-row" : "flex-row-reverse";
  }, [side]);

  if (!hydrated) {
    return <div className="h-screen bg-[#1c1c1c]" />;
  }

  return (
    <div className={`flex h-screen ${rootFlexClass} overflow-hidden bg-[#1c1c1c]`}>
        <aside
          className={
            `relative shrink-0 transition-[width] duration-200 ` +
            (side === "left" ? "border-r border-[#343434]" : "border-l border-[#343434]") +
            (isOpen ? " w-[360px]" : " w-0")
          }
          aria-label="Sidebar"
          aria-hidden={!isOpen}
        >
          <div className={isOpen ? "flex h-full flex-col overflow-hidden" : "hidden"}>
            <div role="tablist" aria-label="Sidebar views" className="bg-[#343434] p-2">
              <div className="flex rounded-md border border-[#808080]/50 bg-[#252525] p-1">
                <button
                  type="button"
                  id="sidebar-tab-chat"
                  role="tab"
                  tabIndex={sidebarView.value === "chat" ? 0 : -1}
                  aria-selected={sidebarView.value === "chat"}
                  aria-controls="sidebar-panel-chat"
                  onClick={() => sidebarView.setValue("chat")}
                  className={
                    "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0078d4] " +
                    (sidebarView.value === "chat"
                      ? "bg-[#343434] text-[#e0e0e0]"
                      : "bg-transparent text-[#808080] hover:text-[#e0e0e0]")
                  }
                >
                  Chat
                </button>
                <button
                  type="button"
                  id="sidebar-tab-editor"
                  role="tab"
                  tabIndex={sidebarView.value === "editor" ? 0 : -1}
                  aria-selected={sidebarView.value === "editor"}
                  aria-controls="sidebar-panel-editor"
                  onClick={() => {
                    sidebarView.setValue("editor");
                  }}
                  className={
                    "flex-1 rounded px-2 py-1 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0078d4] " +
                    (sidebarView.value === "editor"
                      ? "bg-[#343434] text-[#e0e0e0]"
                      : "bg-transparent text-[#808080] hover:text-[#e0e0e0]")
                  }
                >
                  Editor
                </button>
              </div>
            </div>

            <div
              id="sidebar-panel-chat"
              role="tabpanel"
              aria-labelledby="sidebar-tab-chat"
              className={sidebarView.value === "chat" ? "min-h-0 flex-1 overflow-hidden" : "hidden"}
            >
              <ChatSidebar sandpack={sandpack} azureConfig={azureConfig.value} textareaRef={textareaRef} />
            </div>

            <div
              id="sidebar-panel-editor"
              role="tabpanel"
              aria-labelledby="sidebar-tab-editor"
              className={sidebarView.value === "editor" ? "min-h-0 flex-1 overflow-hidden" : "hidden"}
            >
                <div className="flex h-full flex-col">
                  <div className="border-b border-[#343434] bg-[#252525] px-4 py-3">
                    <h2 className="text-sm font-semibold text-[#e0e0e0]">Editor</h2>
                  </div>
                  {selectedElement == null ? (
                    <div className="flex flex-1 items-center justify-center p-6">
                      <div className="max-w-[240px] text-center">
                        <div className="text-xs font-semibold tracking-wide text-[#e0e0e0]">Nothing selected</div>
                        <div className="mt-2 text-xs leading-relaxed text-[#808080]">
                          Click an element on the canvas to inspect and edit.
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-1 flex-col">
                      <div className="border-b border-[#343434] bg-[#1c1c1c] px-4 py-3">
                        <div className="text-[11px] font-medium text-[#808080]">Selected</div>
                        <div className="mt-1 flex items-baseline justify-between gap-3">
                          <div className="text-sm font-semibold text-[#e0e0e0] capitalize">
                            {selectedElement.kind}
                          </div>
                          <div className="text-xs text-[#808080] truncate">{selectedElement.label}</div>
                        </div>
                      </div>

                      <div className="flex flex-1 flex-col gap-4 p-4">
                        <div className="flex flex-col gap-2">
                          <div className="text-[11px] font-medium tracking-wide text-[#808080]">Properties</div>

                          <label className="flex items-center justify-between gap-3 text-xs text-[#e0e0e0]">
                            <span className="text-[#808080]">Background</span>
                            <input
                              type="color"
                              value={selectedElement.styles.backgroundColor}
                              onChange={(e) =>
                                setSelectedElement((prev) =>
                                  prev == null
                                    ? prev
                                    : {
                                        ...prev,
                                        styles: { ...prev.styles, backgroundColor: e.target.value },
                                      },
                                )
                              }
                              aria-label={`Background color, currently ${selectedElement.styles.backgroundColor}`}
                              className="h-8 w-10 cursor-pointer rounded border border-[#343434] bg-transparent"
                            />
                          </label>

                          <label className="flex items-center justify-between gap-3 text-xs text-[#e0e0e0]">
                            <span className="text-[#808080]">Text</span>
                            <input
                              type="color"
                              value={selectedElement.styles.color}
                              onChange={(e) =>
                                setSelectedElement((prev) =>
                                  prev == null
                                    ? prev
                                    : {
                                        ...prev,
                                        styles: { ...prev.styles, color: e.target.value },
                                      },
                                )
                              }
                              aria-label={`Text color, currently ${selectedElement.styles.color}`}
                              className="h-8 w-10 cursor-pointer rounded border border-[#343434] bg-transparent"
                            />
                          </label>

                          <label className="flex items-center justify-between gap-3 text-xs text-[#e0e0e0]">
                            <span className="text-[#808080]">Corner radius</span>
                            <div className="flex items-center gap-2">
                              <input
                                type="number"
                                min={0}
                                value={selectedElement.styles.borderRadiusPx}
                                onChange={(e) =>
                                  setSelectedElement((prev) =>
                                    prev == null
                                      ? prev
                                      : {
                                          ...prev,
                                          styles: {
                                            ...prev.styles,
                                            borderRadiusPx: Number.isFinite(e.target.valueAsNumber)
                                              ? e.target.valueAsNumber
                                              : prev.styles.borderRadiusPx,
                                          },
                                        },
                                  )
                                }
                                aria-label="Corner radius in pixels"
                                className="w-20 rounded-md border border-[#343434] bg-[#252525] px-2 py-1 text-xs text-[#e0e0e0] focus:border-[#505050] focus:outline-none focus:ring-1 focus:ring-[#505050]"
                              />
                              <span className="text-[11px] text-[#808080]">px</span>
                            </div>
                          </label>
                        </div>

                        <div className="flex-1 text-sm text-[#808080]">Inspector coming soon.</div>
                      </div>
                    </div>
                  )}
                </div>

            </div>
          </div>
        </aside>


      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="flex h-10 shrink-0 items-center justify-between border-b border-[#343434] bg-[#252525] px-3">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-[#e0e0e0]">WIG Editor</span>
            <span className="text-xs text-[#808080]">Prototype</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSettings(true)}
              className="grid size-7 place-items-center rounded-md text-[#808080] hover:bg-[#343434] hover:text-[#e0e0e0]"
              aria-label="Settings"
              title="Azure OpenAI Settings"
            >
              <Settings size={16} />
            </button>
            <button
              type="button"
              onClick={swapSidebarSide}
              aria-label="Swap chat sidebar side"
              className="grid size-7 place-items-center rounded-md text-[#808080] hover:bg-[#343434] hover:text-[#e0e0e0]"
              title="Swap side (Cmd/Ctrl+Shift+B)"
            >
              <CornerUpLeft size={16} />
            </button>
          </div>
        </header>

        <div
          className={
            "absolute top-1/2 z-10 -translate-y-1/2 " + (side === "right" ? "right-0" : "left-0")
          }
        >
          <button
            type="button"
            onClick={() => {
              toggleSidebar();
              if (!isOpen) {
                setTimeout(() => textareaRef.current?.focus(), 50);
              }
            }}
            aria-label={isOpen ? "Collapse chat sidebar" : "Expand chat sidebar"}
            className={
              "grid size-8 place-items-center border border-[#343434] bg-[#252525] text-[#808080] shadow-sm transition-colors hover:bg-[#343434] hover:text-[#e0e0e0] " +
              (side === "right" ? "rounded-l-md border-r-0" : "rounded-r-md border-l-0")
            }
            title="Toggle sidebar (Cmd/Ctrl+B)"
          >
            {side === "right" ? (
              isOpen ? (
                <ChevronsRight size={16} />
              ) : (
                <ChevronsLeft size={16} />
              )
            ) : isOpen ? (
              <ChevronsLeft size={16} />
            ) : (
              <ChevronsRight size={16} />
            )}
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          <div className="h-full w-1/2 overflow-hidden">
            <SandpackCodeEditor style={{ height: "100%" }} />
          </div>
          <div className="relative h-full w-1/2 overflow-hidden">
            <SandpackPreview style={{ height: "100%" }} />
            <div
              className="absolute inset-0"
              onMouseDown={(e) => {
                if (e.target === e.currentTarget) {
                  setSelectedElement(null);
                }
              }}
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedElement({
                    kind: "button",
                    label: "Hello Sandpack",
                    styles: { backgroundColor: "#111111", color: "#ffffff", borderRadiusPx: 10 },
                  });
                }}
                className={
                  "absolute left-6 top-6 h-[40px] w-[140px] rounded-[10px] bg-transparent outline-none hover:ring-2 hover:ring-[#0078d4]/60 focus-visible:ring-2 focus-visible:ring-[#0078d4]/80 " +
                  (selectedElement?.kind === "button" ? "ring-2 ring-[#0078d4]" : "")
                }
                aria-label="Select button"
              />
            </div>
          </div>
        </div>
      </div>

      {showSettings && (
        <SettingsModal
          config={azureConfig.value}
          onSave={azureConfig.setValue}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

export default function PlaygroundPage() {
  return (
    <SandpackProvider
      template="react"
      theme="dark"
      files={{
        "/App.js": APP_CODE,
      }}
    >
      <PlaygroundShell />
    </SandpackProvider>
  );
}
