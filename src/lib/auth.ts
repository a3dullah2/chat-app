// JWT session helpers for the Next.js app (httpOnly cookie auth).

import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { signJwt, verifyJwt, getJwtSecret } from "@shared/jwt";
import { JWT_COOKIE, JWT_EXPIRY_SECONDS } from "@shared/constants";
import { publicUserSelect, toPublicUser } from "@shared/dto";
import type { PublicUserRow } from "@shared/dto";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function issueToken(user: { id: string; email: string }): string {
  return signJwt({ sub: user.id, email: user.email }, getJwtSecret(), JWT_EXPIRY_SECONDS);
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(JWT_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: JWT_EXPIRY_SECONDS,
    path: "/",
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(JWT_COOKIE, "", { httpOnly: true, sameSite: "lax", maxAge: 0, path: "/" });
}

export async function getSessionUser(): Promise<PublicUserRow | null> {
  const store = await cookies();
  const token = store.get(JWT_COOKIE)?.value;
  if (!token) return null;
  const payload = verifyJwt(token, getJwtSecret());
  if (!payload) return null;
  return db.user.findUnique({ where: { id: payload.sub }, select: publicUserSelect });
}

export function toSessionUser(user: PublicUserRow) {
  return toPublicUser(user);
}
