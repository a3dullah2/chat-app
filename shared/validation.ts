// Zod validation schemas shared by REST routes and socket handlers (spec §7.5).
// All schemas reject unknown fields. Zod v4.

import { z } from "zod";
import { MAX_TEXT_LENGTH, TELEGRAM_BOT_TOKEN_RE } from "./constants";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const emailSchema = z.string().regex(EMAIL_RE, "Enter a valid email address");

export const signupSchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(2, "Name must be at least 2 characters")
    .max(50, "Name must be at most 50 characters"),
  email: emailSchema,
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password is too long")
    .regex(/[A-Za-z]/, "Password must contain at least one letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
});

export const loginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
});

export const updateProfileSchema = z.strictObject({
  name: z.string().trim().min(2).max(50).optional(),
  about: z.string().trim().max(200).optional(),
  avatarUrl: z.string().max(500).nullable().optional(),
});

export const messageTypes = ["TEXT", "IMAGE", "VIDEO", "AUDIO", "FILE", "STICKER"] as const;

export const sendMessageSchema = z.strictObject({
  clientId: z.string().min(8).max(64),
  conversationId: z.string().min(1),
  type: z.enum(messageTypes),
  text: z.string().max(MAX_TEXT_LENGTH).nullable().optional(),
  replyToId: z.string().min(1).nullable().optional(),
  attachmentId: z.string().min(1).nullable().optional(),
  stickerId: z.string().min(1).nullable().optional(),
});

export const telegramImportSchema = z.strictObject({
  packLink: z
    .string()
    .trim()
    .min(1, "Pack link is required")
    .max(200, "Pack link is too long")
    .regex(
      /^https?:\/\/(?:t\.me|telegram\.me)\/addstickers\/[A-Za-z0-9_]+$/,
      "Enter a valid Telegram sticker link (e.g. https://t.me/addstickers/PackName)",
    ),
  /**
   * Optional per-user Telegram bot token (entered in the Sticker Picker UI).
   * If omitted, the server falls back to process.env.TELEGRAM_BOT_TOKEN so
   * self-hosted deployments that pre-configured the env var keep working.
   * The token is NEVER persisted server-side — it's only used in this
   * request's Telegram API calls.
   */
  botToken: z
    .string()
    .trim()
    .regex(TELEGRAM_BOT_TOKEN_RE, "Enter a valid bot token from @BotFather")
    .optional(),
});

export const stickerUploadSchema = z.strictObject({
  // file is validated separately in the route handler (multipart upload).
  name: z.string().trim().min(1, "Sticker name is required").max(60).optional(),
  emoji: z.string().min(1).max(16).optional(),
});

export const editMessageSchema = z.strictObject({
  messageId: z.string().min(1),
  text: z.string().trim().min(1, "Message cannot be empty").max(MAX_TEXT_LENGTH),
});

export const deleteMessageSchema = z.strictObject({
  messageId: z.string().min(1),
  forEveryone: z.boolean(),
});

export const reactionSchema = z.strictObject({
  messageId: z.string().min(1),
  emoji: z.string().min(1).max(16),
});

export const conversationIdSchema = z.strictObject({
  conversationId: z.string().min(1),
});

export const createDirectSchema = z.strictObject({
  type: z.literal("DIRECT"),
  userId: z.string().min(1),
});

export const createGroupSchema = z.strictObject({
  type: z.literal("GROUP"),
  name: z.string().trim().min(1, "Group name is required").max(60),
  participantIds: z.array(z.string().min(1)).min(2, "Pick at least 2 participants").max(100),
  avatarUrl: z.string().max(500).nullable().optional(),
});

export const createConversationSchema = z.discriminatedUnion("type", [
  createDirectSchema,
  createGroupSchema,
]);

export const updateConversationSchema = z.strictObject({
  name: z.string().trim().min(1).max(60).optional(),
  avatarUrl: z.string().max(500).nullable().optional(),
  addParticipantIds: z.array(z.string().min(1)).max(50).optional(),
  removeParticipantIds: z.array(z.string().min(1)).max(50).optional(),
  isMuted: z.boolean().optional(),
  isPinned: z.boolean().optional(),
  isArchived: z.boolean().optional(),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
});

export const usersSearchSchema = z.object({
  search: z.string().trim().min(2, "Type at least 2 characters").max(100),
});

/** Formats a ZodError into the first human-readable message. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Invalid request";
  return issue.message;
}
