import { describe, expect, it } from "vitest";
import {
  signupSchema,
  loginSchema,
  sendMessageSchema,
  createConversationSchema,
  updateConversationSchema,
  editMessageSchema,
  deleteMessageSchema,
  reactionSchema,
  searchQuerySchema,
  usersSearchSchema,
  updateProfileSchema,
  firstIssue,
} from "@shared/validation";

describe("signupSchema", () => {
  it("accepts a valid signup", () => {
    const result = signupSchema.safeParse({
      name: "Demo User",
      email: "demo@chatapp.com",
      password: "password123",
    });
    expect(result.success).toBe(true);
  });

  it("rejects weak passwords", () => {
    const cases = ["short1", "nodigitshere", "12345678"];
    for (const password of cases) {
      expect(
        signupSchema.safeParse({ name: "Demo User", email: "a@b.c", password }).success,
      ).toBe(false);
    }
  });

  it("rejects bad names and emails", () => {
    expect(signupSchema.safeParse({ name: "D", email: "a@b.c", password: "password123" }).success).toBe(false);
    expect(signupSchema.safeParse({ name: "Demo User", email: "nope", password: "password123" }).success).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(
      signupSchema.safeParse({ name: "Demo User", email: "a@b.c", password: "password123", role: "admin" }).success,
    ).toBe(false);
  });
});

describe("loginSchema", () => {
  it("requires email + password, rejects extras", () => {
    expect(loginSchema.safeParse({ email: "a@b.c", password: "x" }).success).toBe(true);
    expect(loginSchema.safeParse({ email: "a@b.c" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.c", password: "x", admin: true }).success).toBe(false);
  });
});

describe("sendMessageSchema", () => {
  const base = {
    clientId: "client-uuid-123",
    conversationId: "conv-1",
    type: "TEXT",
    text: "hello",
  };

  it("accepts a valid text message", () => {
    expect(sendMessageSchema.safeParse(base).success).toBe(true);
  });

  it("caps text length at 4096", () => {
    expect(sendMessageSchema.safeParse({ ...base, text: "x".repeat(4097) }).success).toBe(false);
  });

  it("rejects invalid types and unknown fields", () => {
    expect(sendMessageSchema.safeParse({ ...base, type: "SYSTEM" }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ ...base, hacked: true }).success).toBe(false);
  });
});

describe("createConversationSchema (discriminated union)", () => {
  it("accepts DIRECT with userId", () => {
    expect(createConversationSchema.safeParse({ type: "DIRECT", userId: "u1" }).success).toBe(true);
  });

  it("requires 2+ participants for GROUP", () => {
    expect(
      createConversationSchema.safeParse({ type: "GROUP", name: "G", participantIds: ["a"] }).success,
    ).toBe(false);
    expect(
      createConversationSchema.safeParse({ type: "GROUP", name: "G", participantIds: ["a", "b"] }).success,
    ).toBe(true);
  });

  it("rejects mismatched payloads", () => {
    expect(createConversationSchema.safeParse({ type: "DIRECT", name: "nope" }).success).toBe(false);
  });
});

describe("updateConversationSchema", () => {
  it("allows participant flags only", () => {
    expect(updateConversationSchema.safeParse({ isMuted: true }).success).toBe(true);
    expect(updateConversationSchema.safeParse({ addParticipantIds: ["a"] }).success).toBe(true);
    expect(updateConversationSchema.safeParse({ sneaky: 1 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Additional edge cases (production readiness sweep)
// ---------------------------------------------------------------------------

describe("editMessageSchema", () => {
  it("rejects empty / whitespace-only text after trim", () => {
    expect(editMessageSchema.safeParse({ messageId: "m1", text: "   " }).success).toBe(false);
    expect(editMessageSchema.safeParse({ messageId: "m1", text: "" }).success).toBe(false);
  });

  it("requires a non-empty messageId", () => {
    expect(editMessageSchema.safeParse({ messageId: "", text: "hi" }).success).toBe(false);
  });

  it("accepts a long text under the cap", () => {
    expect(editMessageSchema.safeParse({ messageId: "m1", text: "x".repeat(4096) }).success).toBe(true);
  });
});

describe("deleteMessageSchema", () => {
  it("requires a boolean forEveryone", () => {
    expect(deleteMessageSchema.safeParse({ messageId: "m1", forEveryone: true }).success).toBe(true);
    expect(deleteMessageSchema.safeParse({ messageId: "m1", forEveryone: "yes" }).success).toBe(false);
    expect(deleteMessageSchema.safeParse({ messageId: "m1" }).success).toBe(false);
  });
});

describe("reactionSchema", () => {
  it("accepts a single-codepoint emoji", () => {
    expect(reactionSchema.safeParse({ messageId: "m1", emoji: "👍" }).success).toBe(true);
  });

  it("accepts multi-codepoint emoji sequences", () => {
    // ❤️‍🔥 (heart with fire) is 5 codepoints
    expect(reactionSchema.safeParse({ messageId: "m1", emoji: "❤️‍🔥" }).success).toBe(true);
  });

  it("rejects empty emoji and over-long emoji", () => {
    expect(reactionSchema.safeParse({ messageId: "m1", emoji: "" }).success).toBe(false);
    expect(reactionSchema.safeParse({ messageId: "m1", emoji: "x".repeat(17) }).success).toBe(false);
  });
});

describe("searchQuerySchema / usersSearchSchema", () => {
  it("requires at least 2 chars", () => {
    expect(searchQuerySchema.safeParse({ q: "a" }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ q: "ab" }).success).toBe(true);
    expect(usersSearchSchema.safeParse({ search: "a" }).success).toBe(false);
    expect(usersSearchSchema.safeParse({ search: "ab" }).success).toBe(true);
  });

  it("trims leading/trailing whitespace before length check", () => {
    expect(searchQuerySchema.safeParse({ q: "  ab  " }).success).toBe(true);
    expect(usersSearchSchema.safeParse({ search: "  a  " }).success).toBe(false);
  });

  it("caps at 100 chars", () => {
    expect(searchQuerySchema.safeParse({ q: "x".repeat(101) }).success).toBe(false);
    expect(usersSearchSchema.safeParse({ search: "x".repeat(101) }).success).toBe(false);
  });
});

describe("updateProfileSchema", () => {
  it("accepts partial profile updates", () => {
    expect(updateProfileSchema.safeParse({ name: "New Name" }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ about: "new about" }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ avatarUrl: null }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ avatarUrl: "https://x/y.png" }).success).toBe(true);
  });

  it("rejects short names and oversized abouts", () => {
    expect(updateProfileSchema.safeParse({ name: "A" }).success).toBe(false);
    expect(updateProfileSchema.safeParse({ about: "x".repeat(201) }).success).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(updateProfileSchema.safeParse({ isAdmin: true }).success).toBe(false);
  });
});

describe("firstIssue", () => {
  it("returns the first issue's message", () => {
    const result = signupSchema.safeParse({ name: "", email: "", password: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = firstIssue(result.error);
      expect(typeof msg).toBe("string");
      expect(msg.length).toBeGreaterThan(0);
    }
  });

  it("returns 'Invalid request' when there are no issues", () => {
    // Construct an empty error to confirm the fallback path.
    const fakeError = { issues: [] } as any;
    expect(firstIssue(fakeError)).toBe("Invalid request");
  });
});

describe("signupSchema (additional edge cases)", () => {
  it("trims the name before length validation", () => {
    expect(signupSchema.safeParse({ name: "  A  ", email: "a@b.c", password: "password123" }).success).toBe(false);
    expect(signupSchema.safeParse({ name: "  Demo  ", email: "a@b.c", password: "password123" }).success).toBe(true);
  });

  it("rejects missing letter or digit in password", () => {
    expect(signupSchema.safeParse({ name: "Demo", email: "a@b.c", password: "password" }).success).toBe(false);
    expect(signupSchema.safeParse({ name: "Demo", email: "a@b.c", password: "12345678" }).success).toBe(false);
  });

  it("accepts a 128-char password and rejects 129", () => {
    const pw128 = "a".repeat(127) + "1";
    expect(signupSchema.safeParse({ name: "Demo", email: "a@b.c", password: pw128 }).success).toBe(true);
    expect(signupSchema.safeParse({ name: "Demo", email: "a@b.c", password: "a" + pw128 }).success).toBe(false);
  });
});
