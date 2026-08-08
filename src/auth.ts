import { timingSafeStringEqual } from "./crypto";

const SESSION_COOKIE = "radar_admin_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MAX_LOGIN_BODY_BYTES = 8_192;

interface SessionPayload {
  username: string;
  expiresAt: number;
  nonce: string;
}

export async function authenticateDashboardLogin(request: Request, env: Env): Promise<Response> {
  const configuredUsername = env.RADAR_DASHBOARD_USERNAME;
  const configuredPassword = env.RADAR_DASHBOARD_PASSWORD;
  if (!configuredUsername || !configuredPassword) {
    return Response.json({ error: "dashboard_credentials_not_configured" }, { status: 503 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_LOGIN_BODY_BYTES) return Response.json({ error: "request_too_large" }, { status: 413 });
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_LOGIN_BODY_BYTES) {
    return Response.json({ error: "request_too_large" }, { status: 413 });
  }
  const form = new URLSearchParams(body);
  const username = form.get("username") ?? "";
  const password = form.get("password") ?? "";
  const valid = await timingSafeStringEqual(username, configuredUsername) && await timingSafeStringEqual(password, configuredPassword);
  if (!valid) {
    return Response.json({ error: "invalid_credentials" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }

  const payload: SessionPayload = {
    username: configuredUsername,
    expiresAt: Math.floor(Date.now() / 1_000) + SESSION_TTL_SECONDS,
    nonce: crypto.randomUUID()
  };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = await signSession(encodedPayload, configuredPassword);
  return Response.json(
    { ok: true, expiresAt: payload.expiresAt },
    {
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": `${SESSION_COOKIE}=${encodedPayload}.${signature}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}`
      }
    }
  );
}

export function logoutDashboard(): Response {
  return Response.json(
    { ok: true },
    {
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": `${SESSION_COOKIE}=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
      }
    }
  );
}

export async function isDashboardSession(request: Request, env: Env): Promise<boolean> {
  const password = env.RADAR_DASHBOARD_PASSWORD;
  if (!password) return false;
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return false;
  const separator = token.lastIndexOf(".");
  if (separator <= 0) return false;
  const encodedPayload = token.slice(0, separator);
  const providedSignature = token.slice(separator + 1);
  const expectedSignature = await signSession(encodedPayload, password);
  if (!(await timingSafeStringEqual(providedSignature, expectedSignature))) return false;

  try {
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(encodedPayload))) as SessionPayload;
    return payload.username === env.RADAR_DASHBOARD_USERNAME && payload.expiresAt > Math.floor(Date.now() / 1_000);
  } catch {
    return false;
  }
}

async function signSession(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return encodeBase64Url(new Uint8Array(signature));
}

function getCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie") ?? "";
  for (const part of cookieHeader.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=") || null;
  }
  return null;
}

function encodeBase64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
