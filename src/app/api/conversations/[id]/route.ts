import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import {
  getConversationDetail,
  updateConversation,
} from "@shared/conversation-service";
import { listMessages } from "@shared/message-service";
import { toMessageDTO } from "@shared/dto";
import { updateConversationSchema, firstIssue } from "@shared/validation";
import { socketEmit } from "@/lib/socket-bridge";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const me = await getSessionUser();
  if (!me) return jsonError(401, "Unauthorized", "UNAUTHORIZED");
  const { id } = await params;

  const result = await getConversationDetail(db, me.id, id);
  if (!result.ok) return jsonError(result.status, result.error, result.code);

  // Last 50 messages are included (spec §8 Conversations GET).
  const messages = await listMessages(db, me.id, id, { limit: 50 });
  if (!messages.ok) return jsonError(messages.status, messages.error, messages.code);

  return NextResponse.json({
    conversation: result.conversation,
    messages: messages.messages.map((m) => toMessageDTO(m, me.id)),
    nextCursor: messages.nextCursor,
  });
}

export async function PATCH(request: Request, { params }: Params): Promise<NextResponse> {
  const me = await getSessionUser();
  if (!me) return jsonError(401, "Unauthorized", "UNAUTHORIZED");
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body", "BAD_REQUEST");
  }

  const parsed = updateConversationSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(422, firstIssue(parsed.error), "VALIDATION");
  }

  const result = await updateConversation(db, me.id, id, parsed.data);
  if (!result.ok) return jsonError(result.status, result.error, result.code);

  for (const systemMessage of result.systemMessages) {
    await socketEmit({ action: "newMessage", messageId: systemMessage.id });
  }
  if (result.systemMessages.length > 0 || result.affectedUserIds.length > 0) {
    await socketEmit({ action: "conversationUpdated", conversationId: id });
  }
  return NextResponse.json({ conversation: result.conversation });
}
