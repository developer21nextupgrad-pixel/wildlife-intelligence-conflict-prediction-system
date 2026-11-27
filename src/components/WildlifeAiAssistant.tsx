import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Database,
  Lock,
  MapPin,
  Minimize2,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { apiBridge } from '../services/apiBridge';
import {
  ASSISTANT_SUGGESTED_QUESTIONS,
  AssistantChatTurn,
  AssistantMapLocation,
  AssistantStatus,
  buildAssistantHistoryPayload,
  getRiskBadgeClasses,
  parseAssistantMarkdown,
  parseInlineFormatting,
} from '../utils/assistantHelpers';

interface WildlifeAiAssistantProps {
  activeDistrict: string;
  activeDateRange: string;
  onFocusMapLocation: (location: AssistantMapLocation) => void;
}

const renderInline = (text: string) => {
  const segments = parseInlineFormatting(text);
  return segments.map((seg, idx) => {
    if (seg.type === 'bold') {
      return (
        <strong key={idx} className="font-semibold text-white">
          {seg.text}
        </strong>
      );
    }
    if (seg.type === 'code') {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 rounded bg-slate-950/90 border border-slate-700/80 text-emerald-300 font-mono text-[11px]"
        >
          {seg.text}
        </code>
      );
    }
    return <React.Fragment key={idx}>{seg.text}</React.Fragment>;
  });
};

const AssistantMarkdownBody: React.FC<{ content: string }> = ({ content }) => {
  const blocks = parseAssistantMarkdown(content);
  return (
    <div className="space-y-2 text-[12.5px] leading-relaxed text-slate-200">
      {blocks.map((block, idx) => {
        if (block.type === 'heading') {
          const cls =
            block.level === 1
              ? 'text-sm font-bold text-white pt-1'
              : block.level === 2
              ? 'text-xs font-bold uppercase tracking-wider text-emerald-300 pt-1'
              : 'text-xs font-bold text-slate-100 pt-0.5';
          return (
            <div key={idx} className={cls}>
              {renderInline(block.text)}
            </div>
          );
        }
        if (block.type === 'ul') {
          return (
            <ul key={idx} className="space-y-1 pl-4 list-disc marker:text-emerald-400">
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }
        if (block.type === 'ol') {
          return (
            <ol key={idx} className="space-y-1 pl-4 list-decimal marker:text-emerald-400">
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx}>{renderInline(item)}</li>
              ))}
            </ol>
          );
        }
        if (block.type === 'table') {
          return (
            <div
              key={idx}
              className="overflow-x-auto rounded-lg border border-slate-700/80 bg-slate-950/70"
            >
              <table className="w-full text-left border-collapse text-[11px]">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/90 text-slate-300">
                    {block.headers.map((h, hIdx) => (
                      <th key={hIdx} className="px-2.5 py-1.5 font-semibold whitespace-nowrap">
                        {renderInline(h)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {block.rows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-slate-900/40">
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="px-2.5 py-1.5 text-slate-200 align-top">
                          {renderInline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={idx}>{renderInline(block.text)}</p>;
      })}
    </div>
  );
};

export const WildlifeAiAssistant: React.FC<WildlifeAiAssistantProps> = ({
  activeDistrict,
  activeDateRange,
  onFocusMapLocation,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<AssistantChatTurn[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const inFlightRef = useRef(false);

  const loadStatus = async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const next = await apiBridge.getAssistantStatus();
      setStatus(next);
    } catch (err) {
      setStatusError(
        err instanceof Error ? err.message : 'Unable to reach AI Assistant backend service.'
      );
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && !status && !statusLoading) {
      void loadStatus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && !isMinimized && (messages.length > 0 || isSending)) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isSending, isOpen, isMinimized]);

  useEffect(() => {
    if (isOpen && !isMinimized) {
      window.setTimeout(() => inputRef.current?.focus(), 140);
    }
  }, [isOpen, isMinimized]);

  const handleOpen = () => {
    setIsOpen(true);
    setIsMinimized(false);
  };

  const handleClose = () => {
    setIsOpen(false);
    setIsMinimized(false);
    setConfirmClear(false);
  };

  const handleClearChat = () => {
    setMessages([]);
    setConfirmClear(false);
    setInputValue('');
  };

  const sendMessage = async (rawPrompt: string) => {
    const trimmed = rawPrompt.trim();
    if (!trimmed || inFlightRef.current || isSending) return;

    inFlightRef.current = true;
    setIsSending(true);
    setConfirmClear(false);

    const historyPayload = buildAssistantHistoryPayload(messages);
    const userTurn: AssistantChatTurn = {
      id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userTurn]);
    setInputValue('');

    try {
      const res = await apiBridge.sendAssistantMessage({
        message: trimmed,
        history: historyPayload,
        activeDistrict,
        activeDateRange,
      });

      const assistantTurn: AssistantChatTurn = {
        id: `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: 'assistant',
        content: res.reply,
        timestamp: res.generatedAt || new Date().toISOString(),
        model: res.model,
        toolsUsed: res.toolsUsed,
        sources: res.sources,
        mapLocations: res.mapLocations,
      };
      setMessages((prev) => [...prev, assistantTurn]);
    } catch (err) {
      const errMsg =
        err instanceof Error
          ? err.message
          : 'Unable to retrieve a response from the AI Wildlife Intelligence Assistant.';
      const errorTurn: AssistantChatTurn = {
        id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        role: 'assistant',
        content: errMsg,
        timestamp: new Date().toISOString(),
        isError: true,
        retryPrompt: trimmed,
      };
      setMessages((prev) => [...prev, errorTurn]);
    } finally {
      inFlightRef.current = false;
      setIsSending(false);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendMessage(inputValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(inputValue);
    }
  };

  const handleRetry = (retryPrompt: string, errorId: string) => {
    if (inFlightRef.current || isSending) return;
    setMessages((prev) => prev.filter((m) => m.id !== errorId));
    void sendMessage(retryPrompt);
  };

  return (
    <div className="fixed bottom-20 right-4 lg:bottom-5 lg:right-5 z-40 flex flex-col items-end pointer-events-none">
      {/* Expanded Floating Chat Panel */}
      {isOpen && !isMinimized && (
        <section
          aria-label="AI Wildlife Intelligence Assistant"
          className="pointer-events-auto mb-3 w-[calc(100vw-2rem)] sm:w-[430px] max-w-[440px] h-[min(640px,calc(100vh-8.5rem))] bg-slate-900/98 backdrop-blur-md border border-slate-700/90 rounded-2xl shadow-2xl shadow-black/60 flex flex-col overflow-hidden transition-all duration-200 animate-in fade-in slide-in-from-bottom-4"
        >
          {/* Header */}
          <div className="px-4 py-3 bg-slate-950/95 border-b border-slate-800 flex items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center shadow-lg shadow-emerald-600/25 border border-emerald-400/40 shrink-0">
                <Bot className="w-5 h-5 text-white" />
                <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-slate-950" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-sm font-bold text-white truncate">
                    Wildlife AI<span className="hidden sm:inline"> Assistant</span>
                  </h2>
                  <span
                    title="Read-only operational intelligence mode"
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono text-emerald-300 shrink-0"
                  >
                    <Lock className="w-2.5 h-2.5" />
                    READ-ONLY
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 truncate">
                  Live WICPS Data Intelligence • {activeDistrict}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={() => setConfirmClear((prev) => !prev)}
                  title="Clear chat history"
                  aria-label="Clear chat history"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-amber-300 hover:bg-slate-800 transition"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsMinimized(true)}
                title="Minimize assistant"
                aria-label="Minimize assistant"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <Minimize2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleClose}
                title="Close assistant"
                aria-label="Close assistant"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Clear Chat Confirmation Bar */}
          {confirmClear && (
            <div className="px-4 py-2.5 bg-amber-950/60 border-b border-amber-700/60 flex items-center justify-between gap-2 text-xs shrink-0">
              <span className="text-amber-200 font-medium">
                Clear current session conversation?
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleClearChat}
                  className="px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-500 text-white font-semibold transition"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {/* Missing Gemini API Key / Backend Status Banner */}
          {status && !status.configured && (
            <div
              role="alert"
              className="mx-3 mt-3 px-3 py-2.5 rounded-xl bg-amber-950/50 border border-amber-700/60 text-amber-200 text-xs flex items-start gap-2 shrink-0"
            >
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1 min-w-0">
                <div className="font-bold text-amber-100">
                  Gemini API Key Required on Backend
                </div>
                <p className="text-[11px] leading-relaxed text-amber-200/90">
                  {status.message ||
                    'Set GEMINI_API_KEY in backend/.env (or .env) and restart the backend server to activate AI responses.'}
                </p>
              </div>
            </div>
          )}

          {statusError && (
            <div
              role="alert"
              className="mx-3 mt-3 px-3 py-2 rounded-xl bg-red-950/60 border border-red-800/70 text-red-200 text-xs flex items-center justify-between gap-2 shrink-0"
            >
              <span className="truncate">{statusError}</span>
              <button
                type="button"
                onClick={() => void loadStatus()}
                className="px-2 py-1 rounded bg-red-900/80 hover:bg-red-800 text-white text-[11px] font-semibold shrink-0"
              >
                Retry
              </button>
            </div>
          )}

          {/* Scrollable Messages Area */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.length === 0 ? (
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Operational Wildlife Intelligence Ready</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Ask questions about high-risk villages, conflict incidents, elephant movement
                    sightings, unresolved alerts, risk zones, and patrol coverage gaps. Responses
                    are grounded in live WICPS database records.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Suggested Questions
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {ASSISTANT_SUGGESTED_QUESTIONS.map((question) => (
                      <button
                        key={question}
                        type="button"
                        disabled={isSending}
                        onClick={() => void sendMessage(question)}
                        className="text-left px-3 py-2 rounded-xl bg-slate-950/70 hover:bg-slate-800/90 border border-slate-800 hover:border-emerald-500/50 text-xs text-slate-200 hover:text-white transition flex items-center justify-between gap-2 group disabled:opacity-50"
                      >
                        <span>{question}</span>
                        <Send className="w-3 h-3 text-slate-500 group-hover:text-emerald-400 shrink-0 transition" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              messages.map((turn) => (
                <div
                  key={turn.id}
                  className={`flex flex-col ${
                    turn.role === 'user' ? 'items-end' : 'items-start'
                  }`}
                >
                  <div
                    className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 ${
                      turn.role === 'user'
                        ? 'bg-emerald-600 text-white rounded-br-sm text-xs leading-relaxed shadow-sm'
                        : turn.isError
                        ? 'bg-red-950/70 border border-red-800/80 text-red-100 rounded-bl-sm'
                        : 'bg-slate-800/90 border border-slate-700/80 text-slate-100 rounded-bl-sm'
                    }`}
                  >
                    {turn.role === 'user' ? (
                      <div className="whitespace-pre-wrap break-words">{turn.content}</div>
                    ) : turn.isError ? (
                      <div className="space-y-2 text-xs">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                          <p className="leading-relaxed text-red-100">{turn.content}</p>
                        </div>
                        {turn.retryPrompt && (
                          <button
                            type="button"
                            onClick={() => handleRetry(turn.retryPrompt!, turn.id)}
                            disabled={isSending}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-800/90 hover:bg-red-700 text-white text-[11px] font-semibold transition disabled:opacity-50"
                          >
                            <RefreshCw className="w-3 h-3" />
                            <span>Retry Question</span>
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <AssistantMarkdownBody content={turn.content} />

                        {/* Verified GIS Map Locations */}
                        {turn.mapLocations && turn.mapLocations.length > 0 && (
                          <div className="pt-2 border-t border-slate-700/70 space-y-1.5">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-emerald-400" />
                              <span>Inspect on WICPS GIS Risk Map</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {turn.mapLocations.slice(0, 6).map((loc) => (
                                <button
                                  key={loc.id}
                                  type="button"
                                  onClick={() => onFocusMapLocation(loc)}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950/90 hover:bg-emerald-950/80 border border-slate-700 hover:border-emerald-500/60 text-[11px] text-slate-200 hover:text-emerald-200 transition text-left"
                                >
                                  <MapPin className="w-3 h-3 text-emerald-400 shrink-0" />
                                  <span className="font-medium truncate max-w-[160px]">
                                    {loc.label}
                                  </span>
                                  {loc.riskLevel && (
                                    <span
                                      className={`px-1.5 py-0.2 rounded border text-[10px] font-semibold ${getRiskBadgeClasses(
                                        loc.riskLevel
                                      )}`}
                                    >
                                      {loc.riskScore !== null && loc.riskScore !== undefined
                                        ? `${loc.riskScore}%`
                                        : loc.riskLevel}
                                    </span>
                                  )}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Source Records Grounding Footer */}
                        {turn.sources && turn.sources.length > 0 && (
                          <div className="pt-2 border-t border-slate-700/60 flex flex-wrap items-center gap-1.5">
                            <Database className="w-3 h-3 text-slate-400 shrink-0" />
                            {turn.sources.map((src, sIdx) => (
                              <span
                                key={`${src.tool}-${sIdx}`}
                                className="px-2 py-0.5 rounded-md bg-slate-950/80 border border-slate-700/70 text-[10px] text-slate-300 font-mono"
                              >
                                {src.label}: {src.recordCount}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}

            {/* Typing / Loading Indicator */}
            {isSending && (
              <div className="flex items-start">
                <div className="px-3.5 py-2.5 rounded-2xl rounded-bl-sm bg-slate-800/90 border border-slate-700/80 flex items-center gap-2.5 text-xs text-slate-300">
                  <div className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:-0.2s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce [animation-delay:-0.1s]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-bounce" />
                  </div>
                  <span>Querying live WICPS intelligence...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input Composer */}
          <form
            onSubmit={handleFormSubmit}
            className="p-3 bg-slate-950/95 border-t border-slate-800 shrink-0"
          >
            <div className="flex items-end gap-2 bg-slate-900 border border-slate-700/90 focus-within:border-emerald-500 rounded-xl px-3 py-2 transition">
              <textarea
                ref={inputRef}
                rows={1}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isSending}
                maxLength={2000}
                placeholder="Ask about village risk, incidents, sightings, alerts, patrols..."
                aria-label="Ask AI Wildlife Intelligence Assistant"
                className="flex-1 bg-transparent text-xs text-white placeholder-slate-500 resize-none focus:outline-hidden max-h-24 leading-relaxed disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={isSending || !inputValue.trim()}
                aria-label="Send message"
                className="p-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white transition shrink-0"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-slate-500 px-0.5">
              <span className="truncate">
                Grounded in live WICPS database
                <span className="hidden sm:inline"> • Press Enter to send</span>
              </span>
              {status?.model && (
                <span className="font-mono shrink-0 whitespace-nowrap">{status.model}</span>
              )}
            </div>
          </form>
        </section>
      )}

      {/* Minimized Session Bar */}
      {isOpen && isMinimized && (
        <div className="pointer-events-auto mb-2 flex items-center gap-2 px-3.5 py-2 rounded-full bg-slate-900/95 border border-emerald-500/50 shadow-xl shadow-black/50 backdrop-blur-md">
          <button
            type="button"
            onClick={() => setIsMinimized(false)}
            className="flex items-center gap-2 text-xs font-semibold text-white hover:text-emerald-300 transition"
          >
            <Bot className="w-4 h-4 text-emerald-400" />
            <span>Wildlife AI</span>
            {messages.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-mono">
                {messages.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close minimized assistant"
            className="p-1 rounded-full text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Floating Launcher Button (Visible when closed) */}
      {!isOpen && (
        <button
          type="button"
          onClick={handleOpen}
          aria-label="Open Wildlife AI Assistant"
          className="pointer-events-auto group relative flex items-center gap-2 pl-2.5 pr-3.5 py-2 rounded-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-xl shadow-emerald-950/60 border border-emerald-400/50 transition-all duration-200 hover:scale-[1.02] active:scale-95"
        >
          <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-slate-950/25 border border-white/20">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-30" />
            <Sparkles className="relative w-3.5 h-3.5 text-emerald-100" />
          </span>
          <span className="text-xs font-bold tracking-wide whitespace-nowrap">Wildlife AI</span>
        </button>
      )}
    </div>
  );
};
