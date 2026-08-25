// Telegram Bot API client for sticker pack import.
//
// Flow (see README §3 — Telegram pack import):
//   1. parsePackName(packLink)  → "CatName"  (validated against TELEGRAM_PACK_LINK_RE)
//   2. getStickerSet(packName) → StickerSet (list of stickers + thumb file_id)
//   3. For each sticker: getFile(file_id) → file_path → downloadFile(file_path)
//   4. Post-process: .tgs → gunzip + store as .json (Lottie)
//                    .webp/.png/.webm → store as-is
//
// All HTTP calls go through Telegram's Bot API at https://api.telegram.org.
// The bot token is read from process.env.TELEGRAM_BOT_TOKEN and NEVER
// returned to the client.

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ungzip } from "pako";
import { TELEGRAM_PACK_LINK_RE, MAX_STICKER_SIZE_BYTES } from "@shared/constants";

const API = "https://api.telegram.org";
const FILE_API = "https://api.telegram.org/file/bot";

export interface TelegramSticker {
  fileId: string;
  /** "image/webp" | "image/png" | "application/tgs" (we remap) | "video/webm" */
  mimeType?: string;
  /** Telegram-provided emoji ("😀", "❤️", etc.) — may be empty. */
  emoji?: string;
  width?: number;
  height?: number;
  isAnimated?: boolean;
  isVideo?: boolean;
}

export interface TelegramStickerSet {
  name: string;
  title: string;
  stickers: TelegramSticker[];
}

/** Extracts and validates the pack name from a t.me/addstickers/<Name> link. */
export function parsePackName(packLink: string): string | null {
  const match = packLink.trim().match(TELEGRAM_PACK_LINK_RE);
  if (!match) return null;
  // Telegram pack names: 0–64 chars; underscores + alphanumerics only.
  const name = match[1];
  if (name.length > 64) return null;
  return name;
}

/** Returns the bot token from env, or throws a friendly error. */
function requireBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token.length < 16) {
    throw new TelegramImportError(
      "Telegram bot token is not configured on the server. Set TELEGRAM_BOT_TOKEN.",
      "TOKEN_MISSING",
    );
  }
  return token;
}

export class TelegramImportError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

async function tgFetch<T>(token: string, method: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${API}/bot${token}/${method}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { method: "GET" });
  if (res.status === 429) {
    const data = (await res.json().catch(() => ({}))) as TgResponse<T>;
    const retry = data.parameters?.retry_after ?? 5;
    throw new TelegramImportError(
      `Telegram rate-limited. Retry in ${retry} second(s).`,
      "TG_RATE_LIMIT",
    );
  }
  const data = (await res.json().catch(() => ({}))) as TgResponse<T>;
  if (!data.ok || !data.result) {
    throw new TelegramImportError(
      data.description ?? `Telegram API call ${method} failed`,
      data.error_code === 404 ? "TG_NOT_FOUND" : "TG_API_ERROR",
    );
  }
  return data.result;
}

/** Calls Telegram's getStickerSet endpoint. */
export async function getStickerSet(packName: string): Promise<TelegramStickerSet> {
  const token = requireBotToken();
  const result = await tgFetch<{
    name: string;
    title: string;
    stickers: Array<{
      file_id: string;
      mime_type?: string;
      emoji?: string;
      width?: number;
      height?: number;
      is_animated?: boolean;
      is_video?: boolean;
    }>;
  }>(token, "getStickerSet", { name: packName });
  return {
    name: result.name,
    title: result.title,
    stickers: result.stickers.map((s) => ({
      fileId: s.file_id,
      mimeType: s.mime_type,
      emoji: s.emoji,
      width: s.width,
      height: s.height,
      isAnimated: !!s.is_animated,
      isVideo: !!s.is_video,
    })),
  };
}

interface TgFile {
  file_id: string;
  file_path: string;
  file_size?: number;
}

/** Calls getFile to resolve a file_id to a CDN path. */
export async function getFile(fileId: string): Promise<TgFile> {
  const token = requireBotToken();
  return tgFetch<TgFile>(token, "getFile", { file_id: fileId });
}

/** Downloads the actual sticker bytes from Telegram's file CDN. */
export async function downloadFile(fileId: string): Promise<{ buffer: Buffer; mimeType: string; ext: string }> {
  const token = requireBotToken();
  const file = await getFile(fileId);
  if (file.file_size && file.file_size > MAX_STICKER_SIZE_BYTES * 4) {
    // Allow up to 2 MB on the wire — .tgs gzips are small but the cap is
    // permissive enough to avoid breaking valid packs while still rejecting
    // obvious abuse. Stored size is enforced separately.
    throw new TelegramImportError(`Sticker too large (${file.file_size} bytes)`, "TOO_LARGE");
  }
  const url = `${FILE_API}${token}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new TelegramImportError(
      `Telegram returned ${res.status} for sticker download`,
      "TG_DOWNLOAD_ERROR",
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());

  // Determine the mime + extension from the file_path.
  const ext = path.extname(file.file_path).toLowerCase();
  let mimeType: string;
  if (ext === ".tgs") mimeType = "application/lottie+json";
  else if (ext === ".webp") mimeType = "image/webp";
  else if (ext === ".webm") mimeType = "video/webm";
  else if (ext === ".png") mimeType = "image/png";
  else if (ext === ".gif") mimeType = "image/gif";
  else mimeType = "application/octet-stream";

  // If it's a .tgs file, decompress now and store as JSON so the client
  // can pass it directly into lottie-react without an extra decode step.
  if (ext === ".tgs") {
    try {
      const json = ungzip(new Uint8Array(buf));
      return { buffer: Buffer.from(json), mimeType: "application/lottie+json", ext: ".json" };
    } catch {
      throw new TelegramImportError("Failed to decompress .tgs file", "TG_TGS_DECODE");
    }
  }

  return { buffer: buf, mimeType, ext };
}

/**
 * Writes a sticker buffer to /uploads/stickers/<userId>/<packId>/<random>.<ext>
 * and returns the storage key. We use the existing /api/files/<storageKey>
 * route to serve these — but it requires keys to match
 * /^[a-f0-9]{16,64}\.[a-z0-9]{1,8}$/ so we generate a random hex name.
 *
 * Returns { storageKey, mime, width, height }.
 */
export async function persistStickerFile(
  userId: string,
  buf: Buffer,
  ext: string,
  width: number | null,
  height: number | null,
): Promise<{ storageKey: string; mime: string; width: number; height: number }> {
  const baseDir = path.join(process.cwd(), "uploads");
  await fs.mkdir(baseDir, { recursive: true });
  const random = crypto.randomBytes(16).toString("hex");
  const storageKey = `${random}${ext}`;
  await fs.writeFile(path.join(baseDir, storageKey), buf);
  return {
    storageKey,
    mime: ext === ".json" ? "application/lottie+json"
      : ext === ".webp" ? "image/webp"
      : ext === ".png" ? "image/png"
      : ext === ".gif" ? "image/gif"
      : ext === ".webm" ? "video/webm"
      : "application/octet-stream",
    width: width ?? 256,
    height: height ?? 256,
  };
}
