"use client";

import { useEffect, useMemo, useRef } from "react";
import { Search, Star, Clock, Plus, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useStickerPickerStore } from "@/stores/sticker-picker-store";
import type { StickerDTO } from "@shared/types";

interface StickerPickerProps {
  /** Called when the user clicks a sticker tile. The parent decides what to do (send / preview / etc). */
  onPickSticker: (sticker: StickerDTO) => void;
  /** Whether the picker should render the "Add Telegram pack" + "Upload sticker" actions. */
  showAddActions?: boolean;
  onAddTelegramPack?: () => void;
  onUploadSticker?: () => void;
  className?: string;
}

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
  onAddTelegramPack,
  onUploadSticker,
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

  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    void loadPacks();
    void loadRecent();
  }, [loadPacks, loadRecent]);

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
      {/* Tab strip */}
      <div
        className="flex items-center gap-1 overflow-x-auto scrollbar-thin px-1 py-1 border-b border-border bg-surface-container"
        role="tablist"
        aria-label="Sticker pack tabs"
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
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
      {showAddActions && (onAddTelegramPack || onUploadSticker) && (
        <div className="flex items-center gap-1 border-t border-border px-2 py-1.5 bg-surface-container">
          {onAddTelegramPack && (
            <button
              type="button"
              onClick={() => {
                onAddTelegramPack?.();
              }}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-surface-container-high hover:text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-ring"
              aria-label="Add a Telegram sticker pack"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add Telegram pack
            </button>
          )}
          {onUploadSticker && (
            <button
              type="button"
              onClick={() => onUploadSticker?.()}
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-surface-container-high hover:text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-ring"
              aria-label="Upload your own sticker"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden />
              Upload
            </button>
          )}
        </div>
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
 *   - application/lottie+json → <Lottie> (added in slice 4)
 *
 * For now Lottie MIME renders a broken-image placeholder; once lottie-react
 * is installed in slice 4, this branch will render the animation.
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
  if (isLottie) {
    // Placeholder until slice 4 ships lottie-react support.
    return (
      <span
        className={cn("inline-flex items-center justify-center", className)}
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
