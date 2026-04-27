import { readFile } from "node:fs/promises";
import crypto from "node:crypto";

const TTS_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

type ServiceAccountKey = {
  type: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
};

type CachedToken = {
  path: string;
  accessToken: string;
  expiresAt: number;
};

let cachedToken: CachedToken | null = null;

export async function getServiceAccountAccessToken(credentialsPath: string): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.path === credentialsPath && cachedToken.expiresAt - now > 60_000) {
    return cachedToken.accessToken;
  }

  const key = await loadServiceAccountKey(credentialsPath);
  const assertion = createJwtAssertion(key, now);
  const tokenUri = key.token_uri || DEFAULT_TOKEN_URI;
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`서비스 계정 access token 발급 실패 (${response.status}): ${body.slice(0, 500)}`);
  }

  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) {
    throw new Error("서비스 계정 token 응답에 access_token이 없습니다.");
  }

  cachedToken = {
    path: credentialsPath,
    accessToken: payload.access_token,
    expiresAt: now + Math.max(60, payload.expires_in || 3600) * 1000
  };
  return cachedToken.accessToken;
}

export async function loadServiceAccountKey(credentialsPath: string): Promise<ServiceAccountKey> {
  const raw = await readFile(credentialsPath, "utf8");
  const parsed = JSON.parse(raw) as Partial<ServiceAccountKey>;
  if (parsed.type !== "service_account") {
    throw new Error("GOOGLE_APPLICATION_CREDENTIALS는 service_account JSON이어야 합니다.");
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("서비스 계정 JSON에 client_email 또는 private_key가 없습니다.");
  }
  return {
    type: parsed.type,
    client_email: parsed.client_email,
    private_key: parsed.private_key,
    token_uri: parsed.token_uri || DEFAULT_TOKEN_URI
  };
}

export function createJwtAssertion(key: ServiceAccountKey, nowMs = Date.now()): string {
  const nowSec = Math.floor(nowMs / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT"
  };
  const claims = {
    iss: key.client_email,
    scope: TTS_SCOPE,
    aud: key.token_uri || DEFAULT_TOKEN_URI,
    exp: nowSec + 3600,
    iat: nowSec
  };
  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(claims)}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsigned)
    .end()
    .sign(key.private_key);
  return `${unsigned}.${base64Url(signature)}`;
}

function base64UrlJson(value: unknown): string {
  return base64Url(Buffer.from(JSON.stringify(value), "utf8"));
}

function base64Url(value: Buffer): string {
  return value
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
