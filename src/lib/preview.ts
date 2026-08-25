// Type-aware preview strings for toasts + chat list rows.

import { formatDuration } from "@shared/format";
import type { MessageDTO } from "@shared/types";

export function messagePreviewFor(message: MessageDTO): string {
  if (message.deletedAt) return "Message deleted";
  switch (message.type) {
    case "IMAGE":
      return message.text?.trim() ? `📷 Photo — ${message.text.trim().slice(0, 42)}` : "📷 Photo";
    case "VIDEO":
      return "📹 Video";
    case "AUDIO": {
      const duration = message.attachments[0]?.durationSec ?? 0;
      return `🎤 Voice message (${formatDuration(duration)})`;
    }
    case "FILE":
      return `📄 ${message.attachments[0]?.fileName ?? "File"}`;
    default:
      return message.text?.slice(0, 120) ?? "";
  }
}
