import {
  clerkClient,
  getAuth,
} from "@clerk/express";
import type { RequestHandler } from "express";

export function signedInUserId(
  userId: string | undefined | null,
): string | null {
  return typeof userId === "string" && userId.length > 0 ? userId : null;
}

export const requireAuthenticatedUser: RequestHandler = (req, res, next) => {
  try {
    const userId = signedInUserId(getAuth(req).userId);
    if (!userId) {
      res.status(401).json({ error: "Sign-in is required." });
      return;
    }
    res.locals.userId = userId;
    next();
  } catch {
    res.status(401).json({ error: "Sign-in is required." });
  }
};

export async function getClerkUser(userId: string) {
  return clerkClient.users.getUser(userId);
}

type ClerkUser = Awaited<ReturnType<typeof getClerkUser>>;

export function getPrimaryEmail(user: ClerkUser) {
  return (
    user.emailAddresses.find(
      (address) => address.id === user.primaryEmailAddressId,
    ) ?? null
  );
}

export function getDisplayName(user: ClerkUser): string | null {
  const name = [user.firstName, user.lastName]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(" ")
    .trim();
  return name || null;
}

export function isConfiguredAdmin(user: ClerkUser): boolean {
  const configuredEmail = process.env.SAI_ADMIN_EMAIL?.trim().toLowerCase();
  const primaryEmail = getPrimaryEmail(user);
  return Boolean(
    configuredEmail &&
      primaryEmail?.verification?.status === "verified" &&
      primaryEmail.emailAddress.toLowerCase() === configuredEmail,
  );
}

export const requireAdmin: RequestHandler = async (_req, res, next) => {
  if (!process.env.SAI_ADMIN_EMAIL?.trim()) {
    res.status(503).json({ error: "Administrator access is not configured." });
    return;
  }
  try {
    const userId = signedInUserId(res.locals.userId);
    if (!userId) {
      res.status(401).json({ error: "Sign-in is required." });
      return;
    }
    const user = await getClerkUser(userId);
    if (!isConfiguredAdmin(user)) {
      res.status(403).json({ error: "Administrator access is required." });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};
