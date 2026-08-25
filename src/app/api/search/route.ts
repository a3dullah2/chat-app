import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { searchMessages } from "@shared/message-service";
import { getConversationList } from "@shared/conversation-service";
import { searchQuerySchema, firstIssue } from "@shared/validation";

/** Sidebar search: title matches + full-text message matches (FR-09 AC1). */
export async function GET(request: Request): Promise<NextResponse> {
  const me = await getSessionUser();
  if (!me) return jsonError(401, "Unauthorized", "UNAUTHORIZED");

  const q = new URL(request.url).searchParams.get("q") ?? "";
  const parsed = searchQuerySchema.safeParse({ q });
  if (!parsed.success) {
    return NextResponse.json({ results: [], conversations: [] });
  }

  const [conversations, messageMatches] = await Promise.all([
    getConversationList(db, me.id),
    searchMessages(db, me.id, parsed.data.q),
  ]);

  const byId = new Map(conversations.map((c) => [c.id, c]));
  const results = messageMatches
    .filter((m) => byId.has(m.conversationId))
    .map((m) => {
      const conv = byId.get(m.conversationId)!;
      return {
        conversationId: m.conversationId,
        conversationTitle:
          conv.type === "GROUP" ? conv.name ?? "Group" : conv.otherParticipant?.name ?? "Direct chat",
        conversationType: conv.type,
        avatarUrl: conv.avatarUrl,
        otherParticipantName: conv.otherParticipant?.name ?? null,
        matchCount: m.matchCount,
        firstMatchMessageId: m.firstMatchMessageId,
        preview: m.preview,
      };
    })
    .sort((a, b) => b.matchCount - a.matchCount)
    .slice(0, 20);

  return NextResponse.json({ results });
}
