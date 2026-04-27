import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import test from "node:test";
import { createJwtAssertion, loadServiceAccountKey } from "../src/googleAuth.ts";

test("loads only service account credential JSON", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "summary-mvp-auth-"));
  const validPath = path.join(dir, "service-account.json");
  await writeFile(validPath, JSON.stringify({
    type: "service_account",
    client_email: "tts@example.iam.gserviceaccount.com",
    private_key: "placeholder",
    token_uri: "https://oauth2.googleapis.com/token"
  }));

  const key = await loadServiceAccountKey(validPath);
  assert.equal(key.client_email, "tts@example.iam.gserviceaccount.com");

  const invalidPath = path.join(dir, "user.json");
  await writeFile(invalidPath, JSON.stringify({ type: "authorized_user" }));
  await assert.rejects(() => loadServiceAccountKey(invalidPath), /service_account/);
});

test("creates a signed JWT assertion for Google OAuth", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

  const assertion = createJwtAssertion({
    type: "service_account",
    client_email: "tts@example.iam.gserviceaccount.com",
    private_key: privatePem,
    token_uri: "https://oauth2.googleapis.com/token"
  }, 1_700_000_000_000);

  const [headerPart, claimPart, signaturePart] = assertion.split(".");
  const header = JSON.parse(Buffer.from(headerPart, "base64url").toString("utf8"));
  const claims = JSON.parse(Buffer.from(claimPart, "base64url").toString("utf8"));

  assert.equal(header.alg, "RS256");
  assert.equal(claims.iss, "tts@example.iam.gserviceaccount.com");
  assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
  assert.match(claims.scope, /cloud-platform/);

  const verified = crypto
    .createVerify("RSA-SHA256")
    .update(`${headerPart}.${claimPart}`)
    .end()
    .verify(publicPem, Buffer.from(signaturePart, "base64url"));
  assert.equal(verified, true);
});
