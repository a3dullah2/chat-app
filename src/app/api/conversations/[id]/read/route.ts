import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { markConversationRead } from "@shared/message-service";
import { socketEmit } from "@/lib/socket-bridge";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params): Promise<NextResponse> {
  const me = await getSessionUser();
  if (!me) return jsonError(401, "Unauthorized", "UNAUTHORIZED");
  const { id } = await params;

  const result = await markConversationRead(db, me.id, id);
  if (!result.ok) return jsonError(result.status, result.error, result.code);

  if (result.updates.length > 0) {
    await socketEmit({ action: "statusUpdate", conversationId: id, updates: result.updates });
  }
  await socketEmit({ action: "conversationUpdated", conversationId: id, userIds: [me.id] });
  return new NextResponse(null, { status: 204 });
}
