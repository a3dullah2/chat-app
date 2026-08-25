import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { editMessage, deleteMessage } from "@shared/message-service";
import { toMessageDTO } from "@shared/dto";
import { editMessageSchema, firstIssue } from "@shared/validation";
import { socketEmit } from "@/lib/socket-bridge";

type Params = { params: Promise<{ id: string }> };

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

  const parsed = editMessageSchema.safeParse({ ...asObject(body), messageId: id });
  if (!parsed.success) {
    return jsonError(422, firstIssue(parsed.error), "VALIDATION");
  }

  const result = await editMessage(db, me.id, id, parsed.data.text);
  if (!result.ok) return jsonError(result.status, result.error, result.code);

  await socketEmit({ action: "messageUpdated", messageId: result.message.id });
  return NextResponse.json({ message: toMessageDTO(result.message, me.id) });
}

export async function DELETE(request: Request, { params }: Params): Promise<NextResponse> {
  const me = await getSessionUser();
  if (!me) return jsonError(401, "Unauthorized", "UNAUTHORIZED");
  const { id } = await params;

  const forEveryone = new URL(request.url).searchParams.get("forEveryone") === "true";

  const result = await deleteMessage(db, me.id, id, forEveryone);
  if (!result.ok) return jsonError(result.status, result.error, result.code);

  if (forEveryone) {
    await socketEmit({ action: "messageUpdated", messageId: result.message.id });
    await socketEmit({
      action: "messageDeleted",
      messageId: result.message.id,
      conversationId: result.message.conversationId,
      deletedAt: result.message.deletedAt?.toISOString() ?? new Date().toISOString(),
    });
    await socketEmit({ action: "conversationUpdated", conversationId: result.message.conversationId });
  } else {
    await socketEmit({
      action: "messageDeleted",
      messageId: result.message.id,
      conversationId: result.message.conversationId,
      userIds: [me.id],
      deletedAt: new Date().toISOString(),
    });
  }
  return new NextResponse(null, { status: 204 });
}

function asObject(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}
