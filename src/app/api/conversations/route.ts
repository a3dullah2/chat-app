import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import {
  getConversationList,
  createDirectConversation,
  createGroupConversation,
} from "@shared/conversation-service";
import { createConversationSchema, firstIssue } from "@shared/validation";
import { socketEmit } from "@/lib/socket-bridge";

export async function GET(): Promise<NextResponse> {
  const me = await getSessionUser();
  if (!me) return jsonError(401, "Unauthorized", "UNAUTHORIZED");
  const conversations = await getConversationList(db, me.id);
  return NextResponse.json({ conversations });
}

export async function POST(request: Request): Promise<NextResponse> {
  const me = await getSessionUser();
  if (!me) return jsonError(401, "Unauthorized", "UNAUTHORIZED");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body", "BAD_REQUEST");
  }

  const parsed = createConversationSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(422, firstIssue(parsed.error), "VALIDATION");
  }

  if (parsed.data.type === "DIRECT") {
    const result = await createDirectConversation(db, me.id, parsed.data.userId);
    if (!result.ok) return jsonError(result.status, result.error, result.code);
    if (result.created) {
      await socketEmit({ action: "conversationUpdated", conversationId: result.conversation.id });
    }
    return NextResponse.json({ conversation: result.conversation }, { status: 201 });
  }

  const result = await createGroupConversation(
    db,
    me.id,
    parsed.data.name,
    parsed.data.participantIds,
    parsed.data.avatarUrl ?? null,
  );
  if (!result.ok) return jsonError(result.status, result.error, result.code);

  // SYSTEM message + list updates for everyone.
  await socketEmit({ action: "newMessage", messageId: result.systemMessage.id });
  await socketEmit({ action: "conversationUpdated", conversationId: result.conversation.id });
  return NextResponse.json({ conversation: result.conversation }, { status: 201 });
}
