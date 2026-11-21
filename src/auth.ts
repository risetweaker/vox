import { invoke, isTauri } from "@tauri-apps/api/core";

const IDENTITY_API = "https://vox-tweaking-utility.netlify.app/.netlify/identity";
const SESSION_KEY = "vox.netlify.identity.session";
const REFRESH_WINDOW_MS = 60_000;

export interface IdentityUser {
  id: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
}

export interface VoxSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: IdentityUser;
}

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

type IdentityOperation = "login" | "refresh" | "user" | "logout";

interface IdentityRequest {
  email?: string;
  password?: string;
  refreshToken?: string;
  accessToken?: string;
}

class IdentityApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "IdentityApiError";
  }
}

export function canSignInFromCurrentContext(): boolean {
  if (isTauri()) return true;
  return typeof window !== "undefined" && window.location.origin === new URL(IDENTITY_API).origin;
}

export function isExpiredIdentitySessionError(cause: unknown): boolean {
  return cause instanceof IdentityApiError && [400, 401, 403].includes(cause.status);
}

export async function getCurrentSession(): Promise<VoxSession | null> {
  let tokens = readStoredTokens();
  if (!tokens) return null;

  if (tokens.expiresAt <= Date.now() + REFRESH_WINDOW_MS) {
    try {
      tokens = await refreshTokens(tokens.refreshToken);
      writeStoredTokens(tokens);
    } catch (cause) {
      if (isExpiredIdentitySessionError(cause)) {
        clearIdentitySession();
        return null;
      }
      throw cause;
    }
  }

  try {
    const user = await requestIdentityJson<IdentityUser>("user", { accessToken: tokens.accessToken });
    if (!user || typeof user.id !== "string") {
      throw new Error("The VOX account service returned an invalid user profile.");
    }
    return { ...tokens, user };
  } catch (cause) {
    if (isExpiredIdentitySessionError(cause)) {
      clearIdentitySession();
      return null;
    }
    throw cause;
  }
}

export async function signInWithPassword(email: string, password: string): Promise<VoxSession> {
  const response = await requestIdentityJson<TokenResponse>("login", { email, password });
  const tokens = parseTokenResponse(response);
  const user = await requestIdentityJson<IdentityUser>("user", { accessToken: tokens.accessToken });
  if (!user || typeof user.id !== "string") {
    throw new Error("The VOX account service returned an invalid user profile.");
  }
  writeStoredTokens(tokens);
  return { ...tokens, user };
}

export async function refreshIdentitySession(session: VoxSession): Promise<VoxSession> {
  const tokens = await refreshTokens(session.refreshToken);
  const user = await requestIdentityJson<IdentityUser>("user", { accessToken: tokens.accessToken });
  if (!user || typeof user.id !== "string") {
    throw new Error("The VOX account service returned an invalid user profile.");
  }
  writeStoredTokens(tokens);
  return { ...tokens, user };
}

export async function signOutIdentity(session: VoxSession): Promise<void> {
  try {
    await requestIdentity("logout", { accessToken: session.accessToken });
  } finally {
    clearIdentitySession();
  }
}

export function clearIdentitySession(): void {
  localStorage.removeItem(SESSION_KEY);
}

async function refreshTokens(refreshToken: string): Promise<StoredTokens> {
  const response = await requestIdentityJson<TokenResponse>("refresh", { refreshToken });
  return parseTokenResponse(response);
}

function parseTokenResponse(value: unknown): StoredTokens {
  if (!isRecord(value) || typeof value.access_token !== "string" || typeof value.refresh_token !== "string") {
    throw new Error("The VOX account service returned an invalid sign-in response.");
  }
  const expiresAt = typeof value.expires_in === "number" && Number.isFinite(value.expires_in)
    ? Date.now() + value.expires_in * 1000
    : readTokenExpiry(value.access_token);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new Error("The VOX account service returned an expired sign-in response.");
  }
  return {
    accessToken: value.access_token,
    refreshToken: value.refresh_token,
    expiresAt,
  };
}

function readTokenExpiry(accessToken: string): number {
  const encodedPayload = accessToken.split(".")[1];
  if (!encodedPayload) return 0;
  try {
    const base64 = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
    const payload: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    if (isRecord(payload) && typeof payload.exp === "number") return payload.exp * 1000;
  } catch {
    return 0;
  }
  return 0;
}

async function requestIdentityJson<T>(operation: IdentityOperation, args: IdentityRequest): Promise<T> {
  const response = await requestIdentity(operation, args);
  try {
    return JSON.parse(response) as T;
  } catch {
    throw new Error("The VOX account service returned invalid JSON.");
  }
}

async function requestIdentity(operation: IdentityOperation, args: IdentityRequest): Promise<string> {
  if (isTauri()) {
    try {
      return await invoke<string>("netlify_identity_request", {
        operation,
        email: args.email,
        password: args.password,
        refreshToken: args.refreshToken,
        accessToken: args.accessToken,
      });
    } catch (cause) {
      throw identityError(cause);
    }
  }

  if (!canSignInFromCurrentContext()) {
    throw new Error("Sign in from the VOX desktop app or open the VOX website directly.");
  }

  const path = operation === "login" || operation === "refresh"
    ? "/token"
    : operation === "user"
      ? "/user"
      : "/logout";
  const headers: Record<string, string> = {};
  let body: URLSearchParams | undefined;
  if (operation === "login") {
    body = new URLSearchParams({
      grant_type: "password",
      username: args.email ?? "",
      password: args.password ?? "",
    });
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  } else if (operation === "refresh") {
    body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: args.refreshToken ?? "",
    });
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }
  if (args.accessToken) headers.Authorization = `Bearer ${args.accessToken}`;

  let response: Response;
  try {
    response = await fetch(`${IDENTITY_API}${path}`, {
      method: operation === "user" ? "GET" : "POST",
      headers,
      body,
      credentials: "same-origin",
    });
  } catch (cause) {
    throw new Error(`Could not reach the VOX account service: ${errorMessage(cause)}`);
  }
  const text = await response.text();
  if (!response.ok) throw responseError(response.status, text);
  return text;
}

function identityError(cause: unknown): Error {
  const message = errorMessage(cause);
  const match = /^NETLIFY_IDENTITY_HTTP_(\d+):(.*)$/.exec(message);
  return match
    ? new IdentityApiError(match[2], Number(match[1]))
    : cause instanceof Error
      ? cause
      : new Error(message);
}

function responseError(status: number, body: string): IdentityApiError {
  let message = "The VOX account service rejected the request.";
  try {
    const payload: unknown = JSON.parse(body);
    if (isRecord(payload)) {
      for (const key of ["msg", "error_description", "error"]) {
        if (typeof payload[key] === "string") {
          message = payload[key];
          break;
        }
      }
    }
  } catch {
    if (body.trim()) message = body.trim();
  }
  return new IdentityApiError(message, status);
}

function readStoredTokens(): StoredTokens | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      isRecord(value) &&
      typeof value.accessToken === "string" &&
      typeof value.refreshToken === "string" &&
      typeof value.expiresAt === "number"
    ) {
      return value as StoredTokens;
    }
  } catch {
    clearIdentitySession();
    throw new Error("Saved VOX sign-in data is damaged. Please sign in again.");
  }
  clearIdentitySession();
  throw new Error("Saved VOX sign-in data is invalid. Please sign in again.");
}

function writeStoredTokens(tokens: StoredTokens): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(tokens));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  return "The VOX account request failed.";
}
