import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError, tooManyRequests } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { listMessages, sendMessage } from "@shared/message-service";
import { toMessageDTO } from "@shared/dto";
import { sendMessageSchema, firstIssue } from "@shared/validation";
import { messageLimiter } from "@shared/rate-limit";
import { RATE_LIMITS, DEFAULT_MESSAGE_PAGE_SIZE, MAX_MESSAGE_PAGE_SIZE } from "@shared/constants";
import { socketEmit } from "@/lib/socket-bridge";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params): Promise<NextResponse> {
  const me = await getSessionUser();
  if (!me) return jsonError(401, "Unauthorized", "UNAUTHORIZED");
  const { id } = await params;

  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor");
  const highlight = url.searchParams.get("highlight");
  const limitParam = Number(url.searchParams.get("limit") ?? DEFAULT_MESSAGE_PAGE_SIZE);
  const limit = Number.isFinite(limitParam)
    ? Math.min(Math.max(Math.trunc(limitParam), 1), MAX_MESSAGE_PAGE_SIZE)
    : DEFAULT_MESSAGE_PAGE_SIZE;

  const result = await listMessages(db, me.id, id, { cursor, highlight, limit });
  if (!result.ok) return jsonError(result.status, result.error, result.code);

  return NextResponse.json({
    messages: result.messages.map((m) => toMessageDTO(m, me.id)),
    nextCursor: result.nextCursor,
  });
}

export async function POST(request: Request, { params }: Params): Promise<NextResponse> {
  const me = await getSessionUser();
  if (!me) return jsonError(401, "Unauthorized", "UNAUTHORIZED");
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body", "BAD_REQUEST");
  }

  const parsed = sendMessageSchema.safeParse({ ...bodyObject(body), conversationId: id });
  if (!parsed.success) {
    return jsonError(422, firstIssue(parsed.error), "VALIDATION");
  }

  // Rate limit: ≤ 20 messages / 10 s / user.
  const rl = messageLimiter.check(`msg:${me.id}`, RATE_LIMITS.message.limit, RATE_LIMITS.message.windowMs);
  if (!rl.allowed) {
    return tooManyRequests(rl.retryAfterSec);
  }

  const result = await sendMessage(db, me.id, parsed.data);
  if (!result.ok) return jsonError(result.status, result.error, result.code);

  // Broadcast through the socket service so every connected client updates.
  await socketEmit({ action: "newMessage", messageId: result.message.id });
  return NextResponse.json({ message: toMessageDTO(result.message, me.id) }, { status: 201 });
}

function bodyObject(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}
