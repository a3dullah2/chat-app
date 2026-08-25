// Pure date/divider/grouping helpers for the message list (unit tested).

export interface DividerItem {
  kind: "divider";
  id: string;
  label: string;
}

export interface MessageRef {
  id: string;
  senderId: string;
  createdAt: string | Date;
}

export interface GroupedMessage<T extends MessageRef> {
  kind: "message";
  id: string;
  message: T;
  /** First message of a consecutive run from the same sender (5-min window). */
  isFirstOfGroup: boolean;
  isLastOfGroup: boolean;
  showSender: boolean; // group chats only (computed by caller)
}

export type ListItem<T extends MessageRef> = DividerItem | GroupedMessage<T>;

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "Today", "Yesterday", or "Aug 12, 2026". */
export function dateDividerLabel(date: Date, now: Date = new Date()): string {
  if (isSameDay(date, now)) return "Today";
  const yesterday = new Date(now.getTime() - DAY_MS);
  if (isSameDay(date, yesterday)) return "Yesterday";
  const sameYear = date.getFullYear() === now.getFullYear();
  const label = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return sameYear ? label : `${label}, ${date.getFullYear()}`;
}

export function formatTime(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes().toString().padStart(2, "0");
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${ampm}`;
}

/** Sidebar timestamp: time for today, "Yesterday", or a short date. */
export function listTimestamp(date: Date, now: Date = new Date()): string {
  if (isSameDay(date, now)) return formatTime(date);
  const yesterday = new Date(now.getTime() - DAY_MS);
  if (isSameDay(date, yesterday)) return "Yesterday";
  const daysAgo = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (daysAgo < 7) {
    return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
  }
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** "last seen today at 3:42 PM" style phrases for the chat header. */
export function lastSeenLabel(user: { isOnline?: boolean; lastSeenAt?: string } | null | undefined, now: Date = new Date()): string {
  if (!user) return "";
  if (user.isOnline) return "online";
  const last = user.lastSeenAt ? new Date(user.lastSeenAt) : null;
  if (!last || Number.isNaN(last.getTime())) return "offline";
  const time = formatTime(last);
  if (isSameDay(last, now)) return `last seen today at ${time}`;
  const yesterday = new Date(now.getTime() - DAY_MS);
  if (isSameDay(last, yesterday)) return `last seen yesterday at ${time}`;
  return `last seen ${MONTHS[last.getMonth()]} ${last.getDate()} at ${time}`;
}

/**
 * Inserts date dividers and computes sender grouping (5-minute window) over an
 * ascending list of messages. `showSenderName` marks messages that should show
 * a sender name/first-bubble tail (pass true only for group conversations).
 */
export function buildListItems<T extends MessageRef>(
  messages: T[],
  opts: { isGroup: boolean; now?: Date },
): ListItem<T>[] {
  const now = opts.now ?? new Date();
  const items: ListItem<T>[] = [];
  let lastDividerKey = "";

  messages.forEach((m, i) => {
    const d = new Date(m.createdAt);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    if (key !== lastDividerKey) {
      lastDividerKey = key;
      items.push({ kind: "divider", id: `divider-${key}`, label: dateDividerLabel(d, now) });
    }

    const prev = messages[i - 1];
    const next = messages[i + 1];
    const withinPrev =
      prev &&
      prev.senderId === m.senderId &&
      new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() <= 5 * 60 * 1000;
    const withinNext =
      next &&
      next.senderId === m.senderId &&
      new Date(next.createdAt).getTime() - new Date(m.createdAt).getTime() <= 5 * 60 * 1000;

    items.push({
      kind: "message",
      id: m.id,
      message: m,
      isFirstOfGroup: !withinPrev,
      isLastOfGroup: !withinNext,
      showSender: opts.isGroup && !withinPrev,
    });
  });

  return items;
}

/** Formats a duration in seconds as m:ss (used in voice note previews). */
export function formatDuration(totalSeconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(totalSeconds ?? 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Pluralised "Alice is typing…" / "Alice and Bob are typing…". */
export function typingLabel(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} more are typing…`;
}
