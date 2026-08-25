// Local-disk file storage for uploads (structure allows swapping in S3 later).
// Files are stored under /uploads with random server-generated names; only
// participants of the owning conversation can fetch them (see files route).

import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import {
  ALLOWED_MIME_TYPES,
  getMaxUploadMb,
  safeExtension,
  sanitizeFileName,
} from "@shared/constants";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const THUMBS_DIR = path.join(UPLOADS_DIR, "thumbs");

const STORAGE_KEY_RE = /^[a-f0-9]{16,64}\.[a-z0-9]{1,8}$/;

export interface StoredFile {
  storageKey: string;
  url: string;
  mimeType: string;
  size: number;
  fileName: string;
  width: number | null;
  height: number | null;
  thumbnailUrl: string | null;
}

export async function ensureUploadDirs(): Promise<void> {
  await fs.mkdir(THUMBS_DIR, { recursive: true });
}

export function fileUrl(storageKey: string): string {
  return `/api/files/${storageKey}`;
}

export function diskPath(storageKey: string): string {
  // path.basename + strict format check guard against traversal.
  const safe = path.basename(storageKey);
  if (!STORAGE_KEY_RE.test(safe)) throw new Error("Invalid storage key");
  return path.join(UPLOADS_DIR, safe);
}

export function thumbDiskPath(storageKey: string): string {
  const safe = path.basename(storageKey);
  if (!STORAGE_KEY_RE.test(safe)) throw new Error("Invalid storage key");
  return path.join(THUMBS_DIR, `${safe}.webp`);
}

export function isAllowedMime(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.has(mimeType);
}

export async function saveUpload(
  file: File,
  opts: { withThumbnail?: boolean } = {},
): Promise<StoredFile> {
  await ensureUploadDirs();

  const maxBytes = getMaxUploadMb() * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new UploadError(`File exceeds the ${getMaxUploadMb()} MB upload limit`, "TOO_LARGE");
  }
  const mimeType = file.type || "application/octet-stream";
  if (!isAllowedMime(mimeType)) {
    throw new UploadError(`File type ${mimeType} is not allowed`, "BAD_MIME");
  }

  const displayName = sanitizeFileName(file.name || "file");
  const buffer = Buffer.from(await file.arrayBuffer());
  const storageKey = `${crypto.randomBytes(16).toString("hex")}${safeExtension(mimeType, file.name || "")}`;
  await fs.writeFile(diskPath(storageKey), buffer);

  let width: number | null = null;
  let height: number | null = null;
  let thumbnailUrl: string | null = null;

  if (mimeType.startsWith("image/")) {
    try {
      const meta = await sharp(buffer).metadata();
      width = meta.width ?? null;
      height = meta.height ?? null;
      if (opts.withThumbnail !== false && mimeType !== "image/gif") {
        // ≤320 px webp thumbnail, served in bubbles; full file opens in lightbox.
        await sharp(buffer)
          .resize({ width: 320, height: 320, fit: "inside", withoutEnlargement: true })
          .webp({ quality: 78 })
          .toFile(thumbDiskPath(storageKey));
        thumbnailUrl = `${fileUrl(storageKey)}?thumb=1`;
      }
    } catch (error) {
      console.warn("[upload] image processing failed:", (error as Error).message);
    }
  }

  return {
    storageKey,
    url: fileUrl(storageKey),
    mimeType,
    size: buffer.length,
    fileName: displayName,
    width,
    height,
    thumbnailUrl,
  };
}

export async function readStoredFile(storageKey: string, thumb = false): Promise<Buffer | null> {
  try {
    const target = thumb ? thumbDiskPath(storageKey) : diskPath(storageKey);
    return await fs.readFile(target);
  } catch {
    return null;
  }
}

export class UploadError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}
