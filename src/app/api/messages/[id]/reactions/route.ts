import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { toggleReaction } from "@shared/message-service";
import { reactionSchema, firstIssue } from "@shared/validation";
import { socketEmit } from "@/lib/socket-bridge";

type Params = { params: Promise<{ id: string }> };

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

  const parsed = reactionSchema.safeParse({ ...asObject(body), messageId: id });
  if (!parsed.success) {
    return jsonError(422, firstIssue(parsed.error), "VALIDATION");
  }

  const result = await toggleReaction(db, me.id, id, parsed.data.emoji);
  if (!result.ok) return jsonError(result.status, result.error, result.code);

  await socketEmit({ action: "reactionUpdate", messageId: id });
  return NextResponse.json({ reactions: result.reactions }, { status: 201 });
}

function asObject(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
}
