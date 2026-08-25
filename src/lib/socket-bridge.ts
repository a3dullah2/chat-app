// Internal emit bridge: lets REST routes trigger socket broadcasts through the
// chat-socket mini-service (http://127.0.0.1:3004/internal/emit).

const BRIDGE_PORT = 3004;
const INTERNAL_TOKEN = process.env.INTERNAL_SOCKET_TOKEN || "chatapp-internal-emit-dev-token";

export interface BridgePayload {
  action:
    | "newMessage"
    | "messageUpdated"
    | "messageDeleted"
    | "reactionUpdate"
    | "statusUpdate"
    | "conversationUpdated";
  messageId?: string;
  conversationId?: string;
  deletedAt?: string;
  updates?: { messageId: string; status: string }[];
  userIds?: string[];
}

export async function socketEmit(payload: BridgePayload): Promise<void> {
  try {
    await fetch(`http://127.0.0.1:${BRIDGE_PORT}/internal/emit`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-token": INTERNAL_TOKEN },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4000),
    });
  } catch (error) {
    // The REST mutation has already been persisted; broadcasting is best-effort.
    console.warn("[socket-bridge] emit failed:", (error as Error).message);
  }
}
