import { getPublicKey, sign, verify } from "@noble/ed25519";
import { Env } from "./env";
import { HttpError } from "./http";
import { getUserRecord, isTokenRevoked, markTokenRevoked } from "./kv";
import type { TrialState, UserRecord } from "./kv";

export interface LicenseClaims {
  sub: string;
  email: string;
  tier: string;
  iat: number;
  exp: number;
  jti: string;
  device_hash?: string;
  epoch: number;
}

export interface TrialClaims {
  sub: string;
  trial: true;
  use: number;
  iat: number;
  exp: number;
  jti: string;
}

function textEncoder(): TextEncoder {
  return new TextEncoder();
}

function utf8ToUint8(value: string): Uint8Array {
  return textEncoder().encode(value);
}

function base64UrlEncode(data: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < data.length; i += 1) {
    binary += String.fromCharCode(data[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlEncodeString(value: string): string {
  return base64UrlEncode(utf8ToUint8(value));
}

function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function parsePrivateKey(base64: string): Uint8Array {
  const trimmed = base64.trim();
  if (!trimmed) {
    throw new HttpError(500, "jwt_config_missing", "JWT private key is not configured");
  }
  try {
    return base64UrlDecode(trimmed);
  } catch {
    // fallback to standard base64 decode using atob on plain string
  }

  try {
    const buffer = Uint8Array.from(atob(trimmed), (c) => c.charCodeAt(0));
    if (!buffer.length) {
      throw new Error("empty");
    }
    return buffer;
  } catch (error) {
    console.error("Failed to parse private key", error);
    throw new HttpError(500, "jwt_key_invalid", "JWT private key is invalid");
  }
}

let signingMaterialPromise: Promise<{ privateKey: Uint8Array; publicKey: Uint8Array }> | null = null;

async function getSigningMaterial(env: Env): Promise<{
  privateKey: Uint8Array;
  publicKey: Uint8Array;
}> {
  if (!signingMaterialPromise) {
    signingMaterialPromise = (async () => {
      const privateKey = parsePrivateKey(env.JWT_PRIVATE_KEY);
      if (privateKey.length !== 32 && privateKey.length !== 64) {
        throw new HttpError(500, "jwt_key_invalid", "JWT private key must be 32 or 64 bytes");
      }
      const publicKey = await getPublicKey(privateKey.slice(0, 32));
      return { privateKey, publicKey };
    })();
  }

  return signingMaterialPromise;
}

export async function derivePublicKey(env: Env): Promise<string> {
  const { publicKey } = await getSigningMaterial(env);
  return base64UrlEncode(publicKey);
}

export interface IssueLicenseOptions {
  userId: string;
  email: string;
  tier: string;
  deviceHash?: string;
  lifetimeSeconds?: number;
  epoch: number;
}

export interface LicenseTokenResult {
  token: string;
  exp: number;
  jti: string;
}

export interface TrialTokenResult {
  token: string;
  exp: number;
  jti: string;
}

export async function issueLicenseToken(env: Env, options: IssueLicenseOptions): Promise<LicenseTokenResult> {
  const { privateKey } = await getSigningMaterial(env);
  const header = {
    alg: "EdDSA",
    typ: "JWT",
  };

  const issuedAt = Math.floor(Date.now() / 1000);
  const lifetimeSeconds = options.lifetimeSeconds ?? 600;
  const exp = issuedAt + lifetimeSeconds;
  const jti = crypto.randomUUID();

  const payload: LicenseClaims = {
    sub: options.userId,
    email: options.email,
    tier: options.tier,
    iat: issuedAt,
    exp,
    jti,
    epoch: options.epoch,
    ...(options.deviceHash ? { device_hash: options.deviceHash } : {}),
  };

  const encodedHeader = base64UrlEncodeString(JSON.stringify(header));
  const encodedPayload = base64UrlEncodeString(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await sign(utf8ToUint8(signingInput), privateKey.slice(0, 32));
  const encodedSignature = base64UrlEncode(signature);
  const token = `${encodedHeader}.${encodedPayload}.${encodedSignature}`;

  return { token, exp, jti };
}

function createTrialError(message: string): HttpError {
  return new HttpError(403, "trial_invalid", message);
}

function assertTrialState(record: UserRecord | null, userId: string): asserts record is UserRecord {
  if (!record) {
    throw createTrialError(`Trial not registered for ${userId}`);
  }
}

export async function issueTrialToken(env: Env, userId: string): Promise<TrialTokenResult> {
  const { privateKey } = await getSigningMaterial(env);
  const header = {
    alg: "EdDSA",
    typ: "JWT",
  };

  const issuedAt = Math.floor(Date.now() / 1000);
  const exp = issuedAt + 15 * 60;
  const jti = crypto.randomUUID();

  const payload: TrialClaims = {
    sub: userId,
    trial: true,
    use: 1,
    iat: issuedAt,
    exp,
    jti,
  };

  const encodedHeader = base64UrlEncodeString(JSON.stringify(header));
  const encodedPayload = base64UrlEncodeString(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = await sign(utf8ToUint8(signingInput), privateKey.slice(0, 32));
  const encodedSignature = base64UrlEncode(signature);
  const token = `${encodedHeader}.${encodedPayload}.${encodedSignature}`;

  return { token, exp, jti };
}

export interface TrialVerificationResult {
  claims: TrialClaims;
  record: UserRecord;
}

function validateTrialState(trial: TrialState, claims: TrialClaims): void {
  if (!trial.allowed) {
    throw createTrialError("Trial access is not allowed");
  }

  if (!trial.started) {
    throw createTrialError("Trial has not been started");
  }

  if (trial.remaining <= 0) {
    throw createTrialError("Trial allocation exhausted");
  }

  if (!trial.jti || trial.jti !== claims.jti) {
    throw createTrialError("Trial token is not recognised");
  }

  if (typeof trial.exp !== "number" || !Number.isFinite(trial.exp)) {
    throw createTrialError("Stored trial expiration is invalid");
  }

  if (claims.exp > trial.exp) {
    throw createTrialError("Trial token expiry exceeds allowed value");
  }
}

export async function verifyTrialToken(env: Env, token: string): Promise<TrialVerificationResult> {
  const { publicKey } = await getSigningMaterial(env);
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw createTrialError("Malformed trial token");
  }

  let headerJson: { alg?: string; typ?: string };
  try {
    headerJson = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedHeader)));
  } catch (error) {
    console.warn("Failed to parse trial token header", error);
    throw createTrialError("Trial token header is invalid");
  }

  if (headerJson.alg !== "EdDSA" || headerJson.typ !== "JWT") {
    throw createTrialError("Unexpected trial token header");
  }

  let payload: TrialClaims;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedPayload))) as TrialClaims;
  } catch (error) {
    console.warn("Failed to parse trial token payload", error);
    throw createTrialError("Trial token payload is invalid");
  }

  if (payload.trial !== true || payload.use !== 1) {
    throw createTrialError("Trial token is missing required flags");
  }

  if (typeof payload.sub !== "string" || payload.sub.trim().length === 0) {
    throw createTrialError("Trial token subject is missing");
  }

  if (typeof payload.jti !== "string" || payload.jti.trim().length === 0) {
    throw createTrialError("Trial token identifier is missing");
  }

  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
    throw createTrialError("Trial token expiry is invalid");
  }

  const signatureBytes = base64UrlDecode(encodedSignature);
  const signingInput = utf8ToUint8(`${encodedHeader}.${encodedPayload}`);
  const isValid = await verify(signatureBytes, signingInput, publicKey);
  if (!isValid) {
    throw createTrialError("Trial token signature is invalid");
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    throw createTrialError("Trial token has expired");
  }

  const userId = payload.sub;
  const record = await getUserRecord(env, userId);
  assertTrialState(record, userId);

  validateTrialState(record.trial, payload);

  return { claims: payload, record };
}

export async function verifyLicenseToken(env: Env, token: string): Promise<LicenseClaims> {
  const { publicKey } = await getSigningMaterial(env);
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !encodedSignature) {
    throw new HttpError(400, "invalid_token", "Malformed token");
  }

  const headerJson = JSON.parse(new TextDecoder().decode(base64UrlDecode(encodedHeader)));
  if (headerJson.alg !== "EdDSA" || headerJson.typ !== "JWT") {
    throw new HttpError(400, "invalid_token", "Unexpected token header");
  }

  const payloadBytes = base64UrlDecode(encodedPayload);
  const signatureBytes = base64UrlDecode(encodedSignature);
  const signingInput = utf8ToUint8(`${encodedHeader}.${encodedPayload}`);
  const isValid = await verify(signatureBytes, signingInput, publicKey);
  if (!isValid) {
    throw new HttpError(401, "invalid_token", "Token signature is invalid");
  }

  const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as LicenseClaims;
  if (typeof payload.epoch !== "number") {
    throw new HttpError(401, "invalid_token", "Token epoch is missing");
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    throw new HttpError(401, "token_expired", "Token is expired");
  }

  if (await isTokenRevoked(env, payload.jti)) {
    throw new HttpError(401, "token_revoked", "Token has been revoked");
  }

  return payload;
}

export async function revokeLicenseToken(env: Env, jti: string, ttlSeconds: number): Promise<void> {
  await markTokenRevoked(env, jti, ttlSeconds);
}
