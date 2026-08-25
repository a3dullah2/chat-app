import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { leaveConversation } from "@shared/conversation-service";
import { socketEmit } from "@/lib/socket-bridge";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params): Promise<NextResponse> {
  const me = await getSessionUser();
  if (!me) return jsonError(401, "Unauthorized", "UNAUTHORIZED");
  const { id } = await params;

  const result = await leaveConversation(db, me.id, id);
  if (!result.ok) return jsonError(result.status, result.error, result.code);

  for (const systemMessage of result.systemMessages) {
    await socketEmit({ action: "newMessage", messageId: systemMessage.id });
  }
  if (!result.deleted) {
    await socketEmit({ action: "conversationUpdated", conversationId: id });
  }
  return new NextResponse(null, { status: 204 });
}
