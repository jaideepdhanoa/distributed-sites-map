import { createSign } from "node:crypto";

function b64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

/** A Sheets access token for the service account. The token and the key are not returned in errors. */
export async function sheetsAccessToken(raw: string, scope: string): Promise<string> {
  let info: { client_email?: string; private_key?: string };
  try {
    info = JSON.parse(raw) as { client_email?: string; private_key?: string };
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
  if (!info.client_email || !info.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is missing the account email or key.");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: info.client_email,
    scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  signer.end();
  const signature = signer.sign(info.private_key).toString("base64url");
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: `${header}.${claim}.${signature}`,
  });
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body });
  if (!response.ok) {
    throw new Error(
      `Google refused a Sheets token (${response.status}). The sync secret is requested as drive.readonly. This read requests ${scope}.`,
    );
  }
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error("Google did not return an access token.");
  return payload.access_token;
}
