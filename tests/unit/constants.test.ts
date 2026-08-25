// Edge cases for constants.ts that the existing tests don't cover:
//   - MIME whitelisting (allow + deny)
//   - safeExtension mapping & fallback
//   - sanitizeFileName against path traversal
//   - getMaxUploadMb reading from env

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  ALLOWED_MIME_TYPES,
  AVATAR_MIME_TYPES,
  safeExtension,
  sanitizeFileName,
  getMaxUploadMb,
  DEFAULT_MAX_UPLOAD_MB,
} from "@shared/constants";

describe("MIME whitelists", () => {
  it("allows common image / video / audio / document types", () => {
    for (const mime of [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "video/mp4",
      "video/webm",
      "audio/webm",
      "audio/mp4",
      "audio/mpeg",
      "audio/wav",
      "audio/ogg",
      "application/pdf",
      "application/zip",
      "application/json",
      "text/plain",
      "text/csv",
      "text/markdown",
    ]) {
      expect(ALLOWED_MIME_TYPES.has(mime)).toBe(true);
    }
  });

  it("rejects executables and scripts", () => {
    expect(ALLOWED_MIME_TYPES.has("application/x-msdownload")).toBe(false);
    expect(ALLOWED_MIME_TYPES.has("application/x-sh")).toBe(false);
    expect(ALLOWED_MIME_TYPES.has("application/octet-stream")).toBe(false);
    expect(ALLOWED_MIME_TYPES.has("text/html")).toBe(false);
  });

  it("avatar whitelist is image-only", () => {
    expect(AVATAR_MIME_TYPES.has("image/png")).toBe(true);
    expect(AVATAR_MIME_TYPES.has("application/pdf")).toBe(false);
    expect(AVATAR_MIME_TYPES.has("video/mp4")).toBe(false);
  });
});

describe("safeExtension", () => {
  it("maps known MIME types to canonical extensions", () => {
    expect(safeExtension("image/jpeg", "anything")).toBe(".jpg");
    expect(safeExtension("image/png", "anything")).toBe(".png");
    expect(safeExtension("application/pdf", "anything")).toBe(".pdf");
    expect(safeExtension("audio/mpeg", "anything")).toBe(".mp3");
    expect(safeExtension("audio/wav", "anything")).toBe(".wav");
  });

  it("falls back to the client filename's extension when MIME is unknown", () => {
    expect(safeExtension("application/x-foo", "report.xlsx")).toBe(".xlsx");
    expect(safeExtension("application/x-foo", "noext")).toBe("");
  });

  it("returns empty string for unsafe extension characters", () => {
    expect(safeExtension("application/x-foo", "file.exe;rm")).toBe("");
    expect(safeExtension("application/x-foo", "file..")).toBe("");
  });

  it("lowercases the fallback extension", () => {
    expect(safeExtension("application/x-foo", "file.PDF")).toBe(".pdf");
  });
});

describe("sanitizeFileName", () => {
  it("strips path separators", () => {
    expect(sanitizeFileName("/etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("../../secret")).toBe("secret");
    expect(sanitizeFileName("C:\\Users\\me\\file.txt")).toBe("file.txt");
  });

  it("removes control characters and shell metacharacters", () => {
    const nasty = "file\u0001\u0002name<banned>:pipe|?.txt";
    const safe = sanitizeFileName(nasty);
    expect(safe).not.toContain("<");
    expect(safe).not.toContain(">");
    expect(safe).not.toContain(":");
    expect(safe).not.toContain("|");
    expect(safe).not.toContain("?");
    expect(safe).not.toContain("\u0001");
    expect(safe).not.toContain("\u0002");
  });

  it("falls back to 'file' for empty input", () => {
    expect(sanitizeFileName("")).toBe("file");
    expect(sanitizeFileName("   ")).toBe("file");
  });

  it("truncates extremely long names", () => {
    expect(sanitizeFileName("a".repeat(500))).toHaveLength(180);
  });
});

describe("getMaxUploadMb", () => {
  const original = process.env.MAX_UPLOAD_MB;
  afterEach(() => {
    if (original === undefined) delete process.env.MAX_UPLOAD_MB;
    else process.env.MAX_UPLOAD_MB = original;
  });

  it("returns the configured value when set to a positive number", () => {
    process.env.MAX_UPLOAD_MB = "50";
    expect(getMaxUploadMb()).toBe(50);
  });

  it("falls back to the default when unset", () => {
    delete process.env.MAX_UPLOAD_MB;
    expect(getMaxUploadMb()).toBe(DEFAULT_MAX_UPLOAD_MB);
  });

  it("falls back when the env value is non-numeric or non-positive", () => {
    process.env.MAX_UPLOAD_MB = "not-a-number";
    expect(getMaxUploadMb()).toBe(DEFAULT_MAX_UPLOAD_MB);
    process.env.MAX_UPLOAD_MB = "0";
    expect(getMaxUploadMb()).toBe(DEFAULT_MAX_UPLOAD_MB);
    process.env.MAX_UPLOAD_MB = "-5";
    expect(getMaxUploadMb()).toBe(DEFAULT_MAX_UPLOAD_MB);
  });
});
