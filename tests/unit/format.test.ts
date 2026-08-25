import { describe, expect, it } from "vitest";
import {
  dateDividerLabel,
  buildListItems,
  formatDuration,
  formatTime,
  isSameDay,
  lastSeenLabel,
  listTimestamp,
  typingLabel,
  formatBytes,
} from "@shared/format";

describe("dateDividerLabel", () => {
  it("labels today and yesterday", () => {
    const now = new Date("2026-08-25T15:00:00");
    expect(dateDividerLabel(new Date("2026-08-25T01:00:00"), now)).toBe("Today");
    expect(dateDividerLabel(new Date("2026-08-24T23:59:00"), now)).toBe("Yesterday");
  });

  it("uses month-day within the same year", () => {
    const now = new Date("2026-08-25T12:00:00");
    expect(dateDividerLabel(new Date("2026-08-12T10:00:00"), now)).toBe("Aug 12");
    expect(dateDividerLabel(new Date("2026-01-02T10:00:00"), now)).toBe("Jan 2");
  });

  it("appends the year for other years", () => {
    const now = new Date("2026-08-25T12:00:00");
    expect(dateDividerLabel(new Date("2024-08-12T10:00:00"), now)).toBe("Aug 12, 2024");
  });
});

describe("buildListItems", () => {
  const base = {
    senderId: "u1",
    createdAt: new Date("2026-08-25T10:00:00").toISOString(),
  };

  it("inserts dividers on day boundaries", () => {
    const items = buildListItems(
      [
        { ...base, id: "a", createdAt: new Date("2026-08-24T10:00:00").toISOString() },
        { ...base, id: "b", createdAt: new Date("2026-08-25T09:00:00").toISOString() },
      ],
      { isGroup: false },
    );
    const dividers = items.filter((i) => i.kind === "divider");
    expect(dividers).toHaveLength(2);
  });

  it("groups consecutive messages from one sender within 5 minutes", () => {
    const t = (mins: number) => new Date(`2026-08-25T10:${String(mins).padStart(2, "0")}:00`).toISOString();
    const items = buildListItems(
      [
        { id: "a", senderId: "u1", createdAt: t(0) },
        { id: "b", senderId: "u1", createdAt: t(2) },
        { id: "c", senderId: "u1", createdAt: t(30) },
        { id: "d", senderId: "u2", createdAt: t(31) },
      ],
      { isGroup: true },
    );
    const messages = items.filter((i) => i.kind === "message");
    const [a, b, c, d] = messages as Extract<(typeof messages)[number], { kind: "message" }>[];
    expect(a.isFirstOfGroup).toBe(true);
    expect(b.isFirstOfGroup).toBe(false);
    expect(c.isFirstOfGroup).toBe(true);
    expect(c.isLastOfGroup).toBe(true);
    expect(d.showSender).toBe(true);
    expect(b.showSender).toBe(false);
  });

  it("does not show sender names in direct chats", () => {
    const items = buildListItems([{ ...base, id: "a" }], { isGroup: false });
    const message = items[1] as Extract<(typeof items)[number], { kind: "message" }>;
    expect(message.showSender).toBe(false);
  });
});

describe("formatting helpers", () => {
  it("formats durations as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(7)).toBe("0:07");
    expect(formatDuration(65)).toBe("1:05");
    expect(formatDuration(null)).toBe("0:00");
  });

  it("formats 12-hour clock times", () => {
    expect(formatTime(new Date("2026-08-25T00:05:00"))).toBe("12:05 AM");
    expect(formatTime(new Date("2026-08-25T13:42:00"))).toBe("1:42 PM");
  });

  it("formats byte sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("formats typing labels with plurals", () => {
    expect(typingLabel([])).toBe("");
    expect(typingLabel(["Alice"])).toBe("Alice is typing…");
    expect(typingLabel(["Alice", "Bob"])).toBe("Alice and Bob are typing…");
    expect(typingLabel(["Alice", "Bob", "Carol", "Dan"])).toBe(
      "Alice, Bob and 2 more are typing…",
    );
  });

  it("formats last-seen phrases", () => {
    const now = new Date("2026-08-25T15:00:00");
    expect(lastSeenLabel({ isOnline: true }, now)).toBe("online");
    expect(lastSeenLabel({ isOnline: false, lastSeenAt: "2026-08-25T09:30:00.000Z".replace("Z", "") }, new Date("2026-08-25T23:00:00"))).toMatch(/last seen today at/);
    expect(lastSeenLabel(null)).toBe("");
  });

  it("uses time for today and weekday names within a week", () => {
    const now = new Date("2026-08-25T15:00:00"); // Tuesday
    expect(listTimestamp(new Date("2026-08-25T08:00:00"), now)).toMatch(/AM|PM/);
    expect(listTimestamp(new Date("2026-08-24T08:00:00"), now)).toBe("Yesterday");
    expect(listTimestamp(new Date("2026-08-21T08:00:00"), now)).toBe("Fri");
    expect(listTimestamp(new Date("2026-05-21T08:00:00"), now)).toBe("May 21");
  });

  it("compares days safely", () => {
    expect(isSameDay(new Date("2026-08-25T01:00:00"), new Date("2026-08-25T23:00:00"))).toBe(true);
    expect(isSameDay(new Date("2026-08-25T01:00:00"), new Date("2026-08-26T01:00:00"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Additional edge cases (production readiness sweep)
// ---------------------------------------------------------------------------

describe("formatBytes (additional edge cases)", () => {
  it("returns 0 B for zero and negative values", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-100)).toBe("-100 B");
  });

  it("uses 1 decimal place exactly at the MB boundary", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1024 * 1024 * 10)).toBe("10.0 MB");
  });

  it("treats 1023 B as bytes, 1024 B as KB", () => {
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1 KB");
  });
});

describe("formatDuration (additional edge cases)", () => {
  it("rounds fractional seconds", () => {
    expect(formatDuration(7.4)).toBe("0:07");
    expect(formatDuration(7.6)).toBe("0:08");
    expect(formatDuration(59.9)).toBe("1:00");
  });

  it("supports multi-minute durations", () => {
    expect(formatDuration(125)).toBe("2:05");
    expect(formatDuration(3600)).toBe("60:00");
  });
});

describe("formatTime (additional edge cases)", () => {
  it("renders 12:00 AM at midnight and 12:00 PM at noon", () => {
    expect(formatTime(new Date("2026-08-25T00:00:00"))).toBe("12:00 AM");
    expect(formatTime(new Date("2026-08-25T12:00:00"))).toBe("12:00 PM");
  });

  it("pads single-digit minutes", () => {
    expect(formatTime(new Date("2026-08-25T09:05:00"))).toBe("9:05 AM");
  });
});

describe("lastSeenLabel (additional edge cases)", () => {
  const now = new Date("2026-08-25T15:00:00");

  it("returns 'offline' when lastSeenAt is missing", () => {
    expect(lastSeenLabel({ isOnline: false }, now)).toBe("offline");
  });

  it("returns 'offline' for an invalid date string", () => {
    expect(lastSeenLabel({ isOnline: false, lastSeenAt: "not-a-date" }, now)).toBe("offline");
  });

  it("uses 'yesterday at <time>' for the previous day", () => {
    expect(lastSeenLabel({ isOnline: false, lastSeenAt: "2026-08-24T09:30:00" }, now)).toMatch(
      /last seen yesterday at/,
    );
  });

  it("falls back to a month-day label for older dates", () => {
    expect(lastSeenLabel({ isOnline: false, lastSeenAt: "2026-08-12T09:30:00" }, now)).toMatch(
      /last seen Aug 12 at/,
    );
  });
});

describe("listTimestamp (additional edge cases)", () => {
  const now = new Date("2026-08-25T15:00:00");

  it("returns 'Yesterday' for the previous day", () => {
    expect(listTimestamp(new Date("2026-08-24T15:00:00"), now)).toBe("Yesterday");
  });

  it("returns weekday names for 2-6 days ago", () => {
    // 2026-08-19 was a Wednesday
    expect(listTimestamp(new Date("2026-08-19T08:00:00"), now)).toBe("Wed");
  });

  it("returns month-day for 7+ days ago", () => {
    expect(listTimestamp(new Date("2026-08-12T08:00:00"), now)).toBe("Aug 12");
  });
});

describe("typingLabel (additional edge cases)", () => {
  it("truncates to exactly the first two names with 'and N more'", () => {
    expect(typingLabel(["Alice", "Bob", "Carol"])).toBe("Alice, Bob and 1 more are typing…");
    expect(typingLabel(["Alice", "Bob", "Carol", "Dan", "Eve"])).toBe(
      "Alice, Bob and 3 more are typing…",
    );
  });
});

describe("buildListItems (additional edge cases)", () => {
  it("returns an empty array for no messages", () => {
    expect(buildListItems([], { isGroup: true })).toEqual([]);
  });

  it("treats exactly 5-min-apart messages as the same group", () => {
    const t = (m: number) => new Date(`2026-08-25T10:0${m}:00`).toISOString();
    const items = buildListItems(
      [
        { id: "a", senderId: "u1", createdAt: t(0) },
        { id: "b", senderId: "u1", createdAt: t(5) }, // exactly 5 min later
      ],
      { isGroup: false },
    );
    const messages = items.filter((i) => i.kind === "message");
    expect((messages[0] as any).isFirstOfGroup).toBe(true);
    // b is within 5 min of a -> continues the group
    expect((messages[1] as any).isFirstOfGroup).toBe(false);
  });

  it("inserts a divider per day across a multi-day span", () => {
    const items = buildListItems(
      [
        { id: "a", senderId: "u1", createdAt: new Date("2026-08-24T10:00:00").toISOString() },
        { id: "b", senderId: "u1", createdAt: new Date("2026-08-25T10:00:00").toISOString() },
        { id: "c", senderId: "u1", createdAt: new Date("2026-08-26T10:00:00").toISOString() },
      ],
      { isGroup: false },
    );
    const dividers = items.filter((i) => i.kind === "divider");
    expect(dividers).toHaveLength(3);
  });
});
