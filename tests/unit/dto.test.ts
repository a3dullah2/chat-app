import { describe, expect, it } from "vitest";
import {
  aggregateReactions,
  aggregateStatuses,
  messagePreview,
  truncate,
  toPublicUser,
  toAttachmentDTO,
} from "@shared/dto";

describe("aggregateStatuses (delivery receipts)", () => {
  const sender = "sender-1";

  it("returns null for the recipient's view (ticks are sender-only)", () => {
    expect(aggregateStatuses([{ userId: sender, status: "READ" }], sender, "someone-else")).toBeNull();
  });

  it("aggregates worst-to-best across recipients", () => {
    const statuses = [
      { userId: "a", status: "READ" },
      { userId: "b", status: "SENT" },
    ];
    expect(aggregateStatuses(statuses, sender, sender)).toBe("SENT");

    const statuses2 = [
      { userId: "a", status: "READ" },
      { userId: "b", status: "DELIVERED" },
    ];
    expect(aggregateStatuses(statuses2, sender, sender)).toBe("DELIVERED");
  });

  it("reports READ only when every recipient read", () => {
    const statuses = [
      { userId: "a", status: "READ" },
      { userId: "b", status: "READ" },
    ];
    expect(aggregateStatuses(statuses, sender, sender)).toBe("READ");
  });

  it("defaults to SENT with no status rows", () => {
    expect(aggregateStatuses([], sender, sender)).toBe("SENT");
  });
});

describe("aggregateReactions", () => {
  it("groups by emoji and flags own reactions", () => {
    const reactions = [
      { emoji: "👍", userId: "u1", user: { name: "Alice" } },
      { emoji: "👍", userId: "u2", user: { name: "Bob" } },
      { emoji: "❤️", userId: "u1", user: { name: "Alice" } },
    ];
    const groups = aggregateReactions(reactions, "u2");
    const thumbs = groups.find((g) => g.emoji === "👍")!;
    expect(thumbs.count).toBe(2);
    expect(thumbs.users).toEqual(["Alice", "Bob"]);
    expect(thumbs.reactedByMe).toBe(true);
    expect(groups.find((g) => g.emoji === "❤️")!.reactedByMe).toBe(false);
  });

  it("handles unknown users gracefully", () => {
    const groups = aggregateReactions([{ emoji: "😂", userId: "x", user: null }], "y");
    expect(groups[0].users).toEqual(["Someone"]);
  });
});

describe("messagePreview (type-aware)", () => {
  it("renders emoji prefixes per type", () => {
    expect(messagePreview("IMAGE", null, [], false)).toBe("📷 Photo");
    expect(messagePreview("VIDEO", null, [], false)).toBe("📹 Video");
    expect(messagePreview("AUDIO", null, [{ fileName: "v.webm", durationSec: 7, mimeType: "audio/webm" }], false)).toBe(
      "🎤 Voice message (0:07)",
    );
    expect(
      messagePreview("FILE", null, [{ fileName: "report.pdf", durationSec: null, mimeType: "application/pdf" }], false),
    ).toBe("📄 report.pdf");
  });

  it("truncates long text previews", () => {
    expect(truncate("x".repeat(100), 42)).toHaveLength(42);
    expect(truncate("x".repeat(42), 42)).toHaveLength(42);
    expect(truncate("short", 42)).toBe("short");
  });

  it("shows a deleted placeholder", () => {
    expect(messagePreview("TEXT", "secret", [], true)).toBe("🚫 Message deleted");
  });
});

// ---------------------------------------------------------------------------
// Additional edge cases (production readiness sweep)
// ---------------------------------------------------------------------------

describe("aggregateStatuses (additional edge cases)", () => {
  const sender = "sender-1";

  it("ignores unknown status values", () => {
    const result = aggregateStatuses(
      [
        { userId: "a", status: "READ" },
        { userId: "b", status: "BOGUS" },
      ],
      sender,
      sender,
    );
    // Unknown status row is skipped; the only known row is READ -> READ.
    expect(result).toBe("READ");
  });

  it("returns SENT when the only row is the sender's own", () => {
    expect(aggregateStatuses([{ userId: sender, status: "READ" }], sender, sender)).toBe("SENT");
  });

  it("treats an empty recipient list as SENT", () => {
    expect(aggregateStatuses([], sender, sender)).toBe("SENT");
  });
});

describe("aggregateReactions (additional edge cases)", () => {
  it("preserves the order of first appearance per emoji", () => {
    const groups = aggregateReactions(
      [
        { emoji: "🔥", userId: "u1", user: { name: "Alice" } },
        { emoji: "👍", userId: "u2", user: { name: "Bob" } },
        { emoji: "🔥", userId: "u3", user: { name: "Carol" } },
      ],
      "u1",
    );
    expect(groups.map((g) => g.emoji)).toEqual(["🔥", "👍"]);
  });

  it("marked reactedByMe only for the viewer's own reactions", () => {
    const groups = aggregateReactions(
      [
        { emoji: "👍", userId: "u1", user: { name: "Alice" } },
        { emoji: "👍", userId: "u2", user: { name: "Bob" } },
      ],
      "u1",
    );
    expect(groups[0].reactedByMe).toBe(true);
    const groups2 = aggregateReactions(
      [
        { emoji: "👍", userId: "u1", user: { name: "Alice" } },
        { emoji: "👍", userId: "u2", user: { name: "Bob" } },
      ],
      "u3",
    );
    expect(groups2[0].reactedByMe).toBe(false);
  });
});

describe("truncate (additional edge cases)", () => {
  it("handles empty and whitespace-only strings", () => {
    expect(truncate("", 10)).toBe("");
    expect(truncate("   ", 10)).toBe("");
  });

  it("preserves the exact string when length equals max", () => {
    expect(truncate("1234567890", 10)).toBe("1234567890");
  });

  it("appends an ellipsis character when truncating", () => {
    // truncate caps the result at `max` chars: slice(0, max-1) + "…".
    expect(truncate("12345678901", 10)).toBe("123456789…");
    expect(truncate("12345678901", 10)).toHaveLength(10);
  });

  it("trims before checking length", () => {
    expect(truncate("   abc   ", 5)).toBe("abc");
    expect(truncate("   abcdefghijk   ", 5)).toBe("abcd…");
  });
});

describe("messagePreview (additional edge cases)", () => {
  it("uses the text for IMAGE with a caption", () => {
    expect(messagePreview("IMAGE", "View from the top", [], false)).toBe("📷 Photo — View from the top");
  });

  it("truncates a long IMAGE caption", () => {
    const long = "x".repeat(100);
    const result = messagePreview("IMAGE", long, [], false);
    expect(result).toBe(`📷 Photo — ${truncate(long, 42)}`);
  });

  it("shows 0:00 for missing duration on audio messages", () => {
    expect(messagePreview("AUDIO", null, [{ fileName: "v.webm", durationSec: null, mimeType: "audio/webm" }], false)).toBe(
      "🎤 Voice message (0:00)",
    );
  });

  it("shows a fallback for FILE when fileName is missing", () => {
    expect(messagePreview("FILE", null, [], false)).toBe("📄 File");
  });

  it("shows the system text for SYSTEM messages", () => {
    expect(messagePreview("SYSTEM", "Alice added Bob", [], false)).toBe("Alice added Bob");
  });

  it("shows the truncated text for long TEXT messages", () => {
    const long = "x".repeat(120);
    expect(messagePreview("TEXT", long, [], false)).toBe(truncate(long, 80));
  });
});

describe("toPublicUser", () => {
  it("serializes a full user with safe defaults", () => {
    const dto = toPublicUser({
      id: "u1",
      name: "Alice",
      email: "a@b.c",
      phone: "+1-555-0100",
      avatarUrl: "/avatar.png",
      about: "Coffee first",
      isOnline: true,
      lastSeenAt: new Date("2026-08-25T15:00:00Z"),
    });
    expect(dto).toEqual({
      id: "u1",
      name: "Alice",
      email: "a@b.c",
      phone: "+1-555-0100",
      avatarUrl: "/avatar.png",
      about: "Coffee first",
      isOnline: true,
      lastSeenAt: "2026-08-25T15:00:00.000Z",
    });
  });

  it("falls back to safe defaults when optional fields are missing", () => {
    const dto = toPublicUser({ id: "u1", name: "Bob" });
    expect(dto.email).toBeUndefined();
    expect(dto.phone).toBeNull();
    expect(dto.avatarUrl).toBeNull();
    expect(dto.about).toBeUndefined();
    expect(dto.isOnline).toBe(false);
    expect(dto.lastSeenAt).toBeUndefined();
  });

  it("handles null lastSeenAt without throwing", () => {
    const dto = toPublicUser({ id: "u1", name: "Bob", lastSeenAt: undefined });
    expect(dto.lastSeenAt).toBeUndefined();
  });
});

describe("toAttachmentDTO", () => {
  it("serializes an attachment row 1:1", () => {
    const dto = toAttachmentDTO({
      id: "a1",
      url: "/api/files/x.png",
      mimeType: "image/png",
      size: 1024,
      fileName: "x.png",
      durationSec: null,
      width: 800,
      height: 600,
      thumbnailUrl: "/api/files/x.png?thumb=1",
    });
    expect(dto).toEqual({
      id: "a1",
      url: "/api/files/x.png",
      mimeType: "image/png",
      size: 1024,
      fileName: "x.png",
      durationSec: null,
      width: 800,
      height: 600,
      thumbnailUrl: "/api/files/x.png?thumb=1",
    });
  });
});
