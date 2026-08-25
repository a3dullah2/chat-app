"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import {
  Search,
  Star,
  Clock,
  Loader2,
  Upload,
  Link as LinkIcon,
  Key,
  Eye,
  EyeOff,
  Check,
  ExternalLink,
  ChevronLeft,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useStickerPickerStore } from "@/stores/sticker-picker-store";
import {
  TELEGRAM_BOT_TOKEN_RE,
  TELEGRAM_BOT_TOKEN_STORAGE_KEY,
} from "@shared/constants";
import type { StickerDTO } from "@shared/types";

// Lottie is only loaded when an animated (.tgs/.json) sticker needs to render.
// Keeps the picker bundle smaller for the common case (WebP/GIF/PNG).
const Lottie = dynamic(() => import("lottie-react").then((m) => m.default), {
  ssr: false,
});

interface StickerPickerProps {
  /** Called when the user clicks a sticker tile. The parent decides what to do (send / preview / etc). */
  onPickSticker: (sticker: StickerDTO) => void;
  /** Whether the picker should render the "Add Telegram pack" + "Upload sticker" actions. */
  showAddActions?: boolean;
  onAddTelegramPack?: () => void;
  onUploadSticker?: () => void;
  className?: string;
}

type Modal = "none" | "telegram" | "upload";

/**
 * Sticker picker popover. Rendered inside a Radix PopoverContent by the
 * composer; can also render as a sheet on mobile (vaul).
 *
 * Tabs (scrollable horizontal strip):
 *   [Recent] [Favorites] [<Pack A>] [<Pack B>] [<My Uploads>] [<Telegram imports>…]
 */
export function StickerPicker({
  onPickSticker,
  showAddActions = true,
  className,
}: StickerPickerProps) {
  const {
    packs,
    loading,
    error,
    recent,
    favoriteIds,
    activeTab,
    loadPacks,
    loadRecent,
    toggleFavorite,
    setActiveTab,
  } = useStickerPickerStore();

  const [modal, setModal] = useState<Modal>("none");
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    void loadPacks();
    void loadRecent();
  }, [loadPacks, loadRecent]);

  // Active-tab auto-scroll: when the active tab changes (including the very
  // first activation after packs load), scroll it fully into view inside the
  // horizontal tab strip. Without this, the active tab can sit just past the
  // right edge of the visible strip and look "cut off" — the exact bug the
  // user reported.
  const tabStripRef = useRef<HTMLDivElement | null>(null);
  const activeTabRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const strip = tabStripRef.current;
    const tab = activeTabRef.current;
    if (!strip || !tab) return;
    // Use nearest so we don't disrupt manual scrolling more than necessary.
    tab.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" });
  }, [activeTab, packs]);

  // Compute the visible stickers for the active tab.
  const visibleStickers: StickerDTO[] = useMemo(() => {
    if (activeTab === "recent") return recent;
    if (activeTab === "favorites") {
      const all = packs.flatMap((p) => p.stickers);
      return all.filter((s) => favoriteIds.has(s.id));
    }
    const pack = packs.find((p) => p.id === activeTab);
    return pack?.stickers ?? [];
  }, [activeTab, recent, favoriteIds, packs]);

  const tabs = useMemo(() => {
    const list: { id: string; label: string; icon?: React.ReactNode }[] = [
      { id: "recent", label: "Recent", icon: <Clock className="h-3.5 w-3.5" aria-hidden /> },
      { id: "favorites", label: "Favorites", icon: <Star className="h-3.5 w-3.5" aria-hidden /> },
    ];
    for (const pack of packs) {
      const isPersonal = pack.ownerId !== null;
      list.push({
        id: pack.id,
        label: pack.name,
        icon: isPersonal ? (
          <Upload className="h-3.5 w-3.5" aria-hidden />
        ) : undefined,
      });
    }
    return list;
  }, [packs]);

  if (loading && packs.length === 0) {
    return (
      <div className={cn("flex items-center justify-center h-44 w-[360px]", className)}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
        <span className="ml-2 text-sm text-muted-foreground">Loading stickers…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("p-4 w-[360px] text-center", className)}>
        <p className="text-sm text-destructive">{error}</p>
        <button
          type="button"
          onClick={() => loadPacks()}
          className="mt-2 text-xs text-primary hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col w-[min(380px,calc(100vw-1rem))] h-[360px] bg-popover text-popover-foreground rounded-[16px] border border-border shadow-lg overflow-hidden",
        className,
      )}
      role="dialog"
      aria-label="Sticker picker"
    >
      {/* Tab strip — `overflow-x-auto` for horizontal scrolling when there
          are many packs. `pr-3` + `scroll-pr-3` give the last tab full
          breathing room so it doesn't get clipped by the picker's
          `overflow-hidden` rounded right edge — the exact bug the user
          reported ("sticker tab loads on an edge and gets cut"). */}
      <div
        ref={tabStripRef}
        className="flex items-center gap-1 overflow-x-auto scrollbar-thin pl-1.5 pr-3 py-1 border-b border-border bg-surface-container [scroll-padding-left:6px] [scroll-padding-right:12px]"
        role="tablist"
        aria-label="Sticker pack tabs"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            ref={(el) => {
              if (activeTab === tab.id) activeTabRef.current = el;
            }}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-ring",
              activeTab === tab.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-surface-container-high hover:text-foreground",
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Sticker grid */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-2">
        {visibleStickers.length === 0 ? (
          <EmptyTab tabId={activeTab} />
        ) : (
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))" }}
          >
            {visibleStickers.map((sticker) => (
              <StickerTile
                key={sticker.id}
                sticker={sticker}
                isFavorite={favoriteIds.has(sticker.id)}
                onPick={() => onPickSticker(sticker)}
                onToggleFavorite={() => toggleFavorite(sticker.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add actions footer */}
      {showAddActions && (
        <div className="flex items-center gap-1 border-t border-border px-2 py-1.5 bg-surface-container">
          <button
            type="button"
            onClick={() => setModal("telegram")}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-surface-container-high hover:text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-ring"
            aria-label="Add a Telegram sticker pack"
          >
            <LinkIcon className="h-3.5 w-3.5" aria-hidden />
            Add Telegram pack
          </button>
          <button
            type="button"
            onClick={() => setModal("upload")}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-surface-container-high hover:text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-ring"
            aria-label="Upload your own sticker"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden />
            Upload
          </button>
        </div>
      )}

      {modal === "telegram" && (
        <TelegramImportModal
          onClose={() => setModal("none")}
          onImported={() => {
            setModal("none");
            void loadPacks();
          }}
        />
      )}
      {modal === "upload" && (
        <UploadStickerModal
          onClose={() => setModal("none")}
          onUploaded={() => {
            setModal("none");
            void loadPacks();
          }}
        />
      )}
    </div>
  );
}

function StickerTile({
  sticker,
  isFavorite,
  onPick,
  onToggleFavorite,
}: {
  sticker: StickerDTO;
  isFavorite: boolean;
  onPick: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <div className="group relative aspect-square">
      <button
        type="button"
        onClick={onPick}
        title={sticker.emoji ?? sticker.packName}
        aria-label={`Send sticker ${sticker.emoji ?? ""} from ${sticker.packName}`}
        className="h-full w-full flex items-center justify-center rounded-[10px] hover:bg-surface-container-high transition-colors focus-visible:outline-2 focus-visible:outline-ring"
      >
        <StickerImage sticker={sticker} className="h-16 w-16 transition-transform group-hover:scale-105" />
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
          if (!isFavorite) toast.success("Added to favorites");
        }}
        title={isFavorite ? "Remove from favorites" : "Add to favorites"}
        aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
        aria-pressed={isFavorite}
        className={cn(
          "absolute -top-1 -right-1 h-5 w-5 rounded-full flex items-center justify-center shadow-sm transition-opacity focus-visible:outline-2 focus-visible:outline-ring",
          isFavorite
            ? "bg-primary text-primary-foreground opacity-100"
            : "bg-surface-container-highest text-muted-foreground opacity-0 group-hover:opacity-100",
        )}
      >
        <Star className={cn("h-3 w-3", isFavorite && "fill-current")} aria-hidden />
      </button>
    </div>
  );
}

function EmptyTab({ tabId }: { tabId: string }) {
  if (tabId === "recent") {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <Clock className="h-8 w-8 text-muted-foreground/60 mb-2" aria-hidden />
        <p className="text-sm text-muted-foreground">
          No recent stickers yet — pick one from a pack.
        </p>
      </div>
    );
  }
  if (tabId === "favorites") {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center px-6">
        <Star className="h-8 w-8 text-muted-foreground/60 mb-2" aria-hidden />
        <p className="text-sm text-muted-foreground">
          No favorites yet — star the stickers you love.
        </p>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6">
      <Search className="h-8 w-8 text-muted-foreground/60 mb-2" aria-hidden />
      <p className="text-sm text-muted-foreground">No stickers in this pack.</p>
    </div>
  );
}

/**
 * Renders a sticker image. Picks the right tag based on MIME:
 *   - image/* → <img>
 *   - application/lottie+json → <Lottie> (renders the Lottie animation inline)
 */
export function StickerImage({
  sticker,
  className,
  size,
}: {
  sticker: StickerDTO;
  className?: string;
  size?: number;
}) {
  const isLottie = sticker.mime === "application/lottie+json";
  const [lottieData, setLottieData] = useState<object | null>(null);

  useEffect(() => {
    if (!isLottie) return;
    let cancelled = false;
    // Sticker JSON is small (~2-10 KB). Fetch lazily so the picker only
    // pulls down Lottie data for stickers it actually renders.
    fetch(sticker.url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data) => {
        if (!cancelled) setLottieData(data);
      })
      .catch(() => {
        // Fall back to the emoji placeholder on fetch failure.
        if (!cancelled) setLottieData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isLottie, sticker.url]);

  if (isLottie) {
    if (lottieData) {
      return (
        <Lottie
          animationData={lottieData}
          loop
          autoplay
          className={cn(className)}
          style={size ? { width: size, height: size } : undefined}
        />
      );
    }
    return (
      <span
        className={cn("inline-flex items-center justify-center animate-pulse", className)}
        style={size ? { width: size, height: size } : undefined}
        aria-label={`Animated sticker ${sticker.emoji ?? ""}`}
      >
        <span className="text-3xl">{sticker.emoji ?? "🏷️"}</span>
      </span>
    );
  }
  return (
    <img
      src={sticker.url}
      alt={sticker.emoji ?? "Sticker"}
      width={size ?? sticker.width}
      height={size ?? sticker.height}
      loading="lazy"
      draggable={false}
      className={cn("object-contain pointer-events-none select-none", className)}
    />
  );
}

// ---------------------------------------------------------------------------
// Modals — Add Telegram pack + Upload sticker
// ---------------------------------------------------------------------------

/**
 * Reads/writes the per-user Telegram bot token in localStorage. The token
 * is per-device (per-browser) — the server never persists it. It's only
 * sent in the body of POST /api/stickers/import-telegram.
 *
 * Uses `useSyncExternalStore` so the value is hydrated without triggering
 * the `set-state-in-effect` anti-pattern (which causes cascading renders).
 * The subscription listens for cross-tab `storage` events; same-tab
 * mutations done via `save` / `clear` are also propagated by dispatching
 * a custom event that the same-tab listener picks up (the `storage` event
 * only fires for OTHER tabs, not the tab that made the change).
 */
const _TG_TOKEN_EVENT = "chat:telegram-bot-token-change";

function _tgTokenRead(): string | null {
  try {
    return localStorage.getItem(TELEGRAM_BOT_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function _tgTokenSubscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  window.addEventListener(_TG_TOKEN_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(_TG_TOKEN_EVENT, callback);
  };
}

// Hydration flag — server snapshot is `false`, client snapshot is `true`.
// Using `useSyncExternalStore` for this avoids the `set-state-in-effect`
// anti-pattern that `useState(false) + useEffect(setHydrated(true))` would
// trigger, while still letting the picker render a tiny skeleton instead
// of flashing the "no token" UI for one frame before localStorage resolves.
const _hydratedSubscribe = () => () => {};
const _hydratedGetClient = () => true;
const _hydratedGetServer = () => false;

function useTelegramBotToken() {
  // Server snapshot is null so SSR + first client render match — avoiding
  // hydration mismatch warnings. After hydration, `getSnapshot` reads the
  // actual localStorage value, triggering a single re-render if it differs.
  const token = useSyncExternalStore(
    _tgTokenSubscribe,
    _tgTokenRead,
    () => null,
  );
  const hydrated = useSyncExternalStore(
    _hydratedSubscribe,
    _hydratedGetClient,
    _hydratedGetServer,
  );

  const save = useCallback((next: string) => {
    const trimmed = next.trim();
    try {
      if (trimmed) localStorage.setItem(TELEGRAM_BOT_TOKEN_STORAGE_KEY, trimmed);
      else localStorage.removeItem(TELEGRAM_BOT_TOKEN_STORAGE_KEY);
    } catch {
      /* swallow */
    }
    // Notify the same-tab subscription (the `storage` event only fires for
    // other tabs).
    window.dispatchEvent(new Event(_TG_TOKEN_EVENT));
  }, []);

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(TELEGRAM_BOT_TOKEN_STORAGE_KEY);
    } catch {
      /* swallow */
    }
    window.dispatchEvent(new Event(_TG_TOKEN_EVENT));
  }, []);

  return { token, hydrated, save, clear };
}

/** Shows the last 4 chars of the secret hash, hides the rest. */
function maskToken(token: string): string {
  // Token format: "<bot_id>:<hash>". Keep the bot id visible (it's not
  // secret), mask everything but the last 4 of the hash.
  const idx = token.indexOf(":");
  if (idx < 0) return "•".repeat(token.length);
  const botId = token.slice(0, idx);
  const hash = token.slice(idx + 1);
  if (hash.length <= 4) return `${botId}:${"•".repeat(hash.length)}`;
  return `${botId}:${"•".repeat(hash.length - 4)}${hash.slice(-4)}`;
}

function TelegramImportModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const { token, hydrated, save, clear } = useTelegramBotToken();
  const [packLink, setPackLink] = useState("");
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [draftToken, setDraftToken] = useState("");
  const [showTokenSecret, setShowTokenSecret] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasToken = !!token;

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/stickers/import-telegram", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          packLink: packLink.trim(),
          // Send the saved token. If null, the server falls back to env var.
          botToken: token ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Import failed");
        return;
      }
      const skip = data.skipped > 0 ? ` (${data.skipped} skipped)` : "";
      toast.success(`Imported "${data.name}" — ${data.stickerCount} sticker${data.stickerCount === 1 ? "" : "s"}${skip}`);
      onImported();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const saveToken = () => {
    const trimmed = draftToken.trim();
    if (!trimmed) {
      setTokenError("Paste your bot token first.");
      return;
    }
    if (!TELEGRAM_BOT_TOKEN_RE.test(trimmed)) {
      setTokenError("Enter a valid token — format is <bot_id>:<hash> from @BotFather.");
      return;
    }
    save(trimmed);
    setDraftToken("");
    setTokenError(null);
    setShowTokenForm(false);
    toast.success("Telegram bot token saved");
  };

  const removeToken = () => {
    clear();
    setDraftToken("");
    setShowTokenForm(false);
    setTokenError(null);
    toast.success("Telegram bot token removed");
  };

  // ---- Body — switches between the token-setup form and the pack-link form
  // so the user is funnelled through the token step before they can import.
  // If a token is already saved, the pack-link form renders by default with
  // a small "Edit token" link below it.
  return (
    <div
      className="absolute inset-0 z-40 flex flex-col bg-popover text-popover-foreground p-3 gap-2"
      role="dialog"
      aria-label="Add a Telegram sticker pack"
    >
      {/* Header — title row changes depending on sub-screen */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {showTokenForm && (
            <button
              type="button"
              onClick={() => {
                setShowTokenForm(false);
                setTokenError(null);
                setDraftToken("");
              }}
              className="shrink-0 text-muted-foreground hover:text-foreground rounded-full p-0.5 focus-visible:outline-2 focus-visible:outline-ring"
              aria-label="Back to pack link"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
          )}
          <p className="text-sm font-semibold truncate">
            {showTokenForm
              ? hasToken
                ? "Edit Telegram token"
                : "Add your Telegram bot token"
              : "Add a Telegram sticker pack"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 text-muted-foreground hover:text-foreground text-sm focus-visible:outline-2 focus-visible:outline-ring rounded"
          aria-label="Close"
        >
          Cancel
        </button>
      </div>

      {!hydrated ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
        </div>
      ) : showTokenForm ? (
        // ---- Token form ----
        <>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Create a bot with{" "}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 text-primary hover:underline align-baseline"
            >
              @BotFather
              <ExternalLink className="h-3 w-3" aria-hidden />
            </a>{" "}
            → send{" "}
            <code className="rounded bg-surface-container-high px-1 py-0.5 text-[10px]">/newbot</code>
            {" "}→ copy the token it gives you. We store it only in this browser and send it
            with each import request — never to our database.
          </p>
          <div className="relative">
            <input
              type={showTokenSecret ? "text" : "password"}
              value={draftToken}
              onChange={(e) => {
                setDraftToken(e.target.value);
                setTokenError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveToken();
              }}
              placeholder="1234567890:AAH…-…-…"
              autoFocus
              spellCheck={false}
              autoComplete="off"
              aria-label="Telegram bot token"
              className="w-full rounded-[12px] border border-border bg-surface-container-high px-3 py-2 pr-9 text-sm font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <button
              type="button"
              onClick={() => setShowTokenSecret((s) => !s)}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground rounded p-1 focus-visible:outline-2 focus-visible:outline-ring"
              aria-label={showTokenSecret ? "Hide token" : "Show token"}
              tabIndex={-1}
            >
              {showTokenSecret ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
            </button>
          </div>
          {tokenError && (
            <p className="text-xs text-destructive" role="alert">
              {tokenError}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1">
            <button
              type="button"
              onClick={saveToken}
              className="flex-1 rounded-full bg-primary text-primary-foreground text-sm font-medium py-2 px-3 hover:bg-primary/90 transition-colors focus-visible:outline-2 focus-visible:outline-ring"
            >
              Save token
            </button>
            {hasToken && (
              <button
                type="button"
                onClick={removeToken}
                className="rounded-full text-destructive hover:bg-destructive/10 text-sm font-medium py-2 px-3 transition-colors focus-visible:outline-2 focus-visible:outline-ring"
              >
                Remove
              </button>
            )}
          </div>
        </>
      ) : !hasToken ? (
        // ---- No token yet — funnel user to token form ----
        <>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            To import a pack you first need a Telegram bot token. We&apos;ll store it
            in this browser only — never in our database.
          </p>
          <button
            type="button"
            onClick={() => {
              setShowTokenForm(true);
              setDraftToken("");
              setTokenError(null);
            }}
            className="w-full rounded-[12px] border border-dashed border-border bg-surface-container-high px-3 py-3 text-sm text-muted-foreground hover:bg-surface-container-highest hover:text-foreground transition-colors flex items-center justify-center gap-2 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Key className="h-4 w-4" aria-hidden />
            Add your Telegram bot token
          </button>
        </>
      ) : (
        // ---- Pack link form (token already saved) ----
        <>
          <input
            type="url"
            value={packLink}
            onChange={(e) => setPackLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && packLink.trim() && !loading) void submit();
            }}
            placeholder="https://t.me/addstickers/PackName"
            autoFocus
            disabled={loading}
            aria-label="Telegram pack link"
            className="w-full rounded-[12px] border border-border bg-surface-container-high px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-[11px] text-muted-foreground">
            Paste a Telegram sticker pack link. The pack lands in your personal library — only you can use it.
          </p>
          {/* Saved-token chip with an "edit" action so users can update or
              replace the token without re-doing the whole import flow. */}
          <div className="flex items-center justify-between gap-2 rounded-[12px] bg-surface-container-high border border-border px-2.5 py-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-primary/10 text-primary shrink-0"
                aria-hidden
              >
                <Check className="h-3 w-3" />
              </span>
              <span className="text-[11px] text-muted-foreground truncate">
                Token saved —{" "}
                <code className="font-mono">{maskToken(token!)}</code>
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setShowTokenForm(true);
                setDraftToken("");
                setTokenError(null);
              }}
              className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/10 transition-colors focus-visible:outline-2 focus-visible:outline-ring"
            >
              Edit
            </button>
          </div>
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => void submit()}
            disabled={loading || !packLink.trim()}
            className="mt-1 rounded-full bg-primary text-primary-foreground text-sm font-medium py-2 px-3 disabled:opacity-50 hover:bg-primary/90 transition-colors focus-visible:outline-2 focus-visible:outline-ring"
          >
            {loading ? "Importing…" : "Import pack"}
          </button>
        </>
      )}
    </div>
  );
}

function UploadStickerModal({
  onClose,
  onUploaded,
}: {
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [emoji, setEmoji] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (emoji.trim()) form.append("emoji", emoji.trim());
      const res = await fetch("/api/stickers/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Upload failed");
        return;
      }
      toast.success("Sticker added to your library");
      onUploaded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-40 flex flex-col bg-popover text-popover-foreground p-3 gap-2"
      role="dialog"
      aria-label="Upload a sticker"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Upload a sticker</p>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-sm"
          aria-label="Close"
        >
          Cancel
        </button>
      </div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="w-full rounded-[12px] border-2 border-dashed border-border bg-surface-container-high px-3 py-4 text-sm text-muted-foreground hover:bg-surface-container-highest transition-colors focus-visible:outline-2 focus-visible:outline-ring"
      >
        {file ? (
          <span className="text-foreground">{file.name} ({Math.round(file.size / 1024)} KB)</span>
        ) : (
          "Click to pick a PNG / WebP / GIF (≤ 500 KB)"
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) setFile(f);
          e.target.value = "";
        }}
      />
      <input
        type="text"
        value={emoji}
        onChange={(e) => setEmoji(e.target.value)}
        placeholder="Optional emoji (e.g. 😀)"
        maxLength={16}
        disabled={loading}
        aria-label="Optional emoji"
        className="w-full rounded-[12px] border border-border bg-surface-container-high px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={loading || !file}
        className="mt-1 rounded-full bg-primary text-primary-foreground text-sm font-medium py-2 px-3 disabled:opacity-50 hover:bg-primary/90 transition-colors focus-visible:outline-2 focus-visible:outline-ring"
      >
        {loading ? "Uploading…" : "Add to library"}
      </button>
    </div>
  );
}
