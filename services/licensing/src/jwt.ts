import { getPublicKey, sign, verify } from "@noble/ed25519";
import { Env } from "./env";
import { HttpError } from "./http";
import { isTokenRevoked, markTokenRevoked } from "./kv";

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

function normalizeSecret(raw: string): string {
  if (!raw) {
    return "";
  }

  let trimmed = raw.trim();
  if (trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    trimmed = trimmed.slice(1, -1).trim();
  } else if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    trimmed = trimmed.slice(1, -1).trim();
  }

  return trimmed.replace(/\r\n/g, "\n").trim();
}

function decodeBase64Flexible(value: string): Uint8Array {
  const normalized = value.replace(/\s+/g, "");
  if (!normalized) {
    throw new Error("empty");
  }

  const standard = normalized.replace(/-/g, "+").replace(/_/g, "/");
  const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function extractInnerOctet(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 2 || bytes[0] !== 0x04) {
    return bytes;
  }

  let offset = 1;
  let length = bytes[offset];
  offset += 1;
  if (length & 0x80) {
    const lengthBytes = length & 0x7f;
    if (lengthBytes === 0 || offset + lengthBytes > bytes.length) {
      throw new Error("Invalid ASN.1 length");
    }
    length = 0;
    for (let i = 0; i < lengthBytes; i += 1) {
      length = (length << 8) | bytes[offset + i];
    }
    offset += lengthBytes;
  }

  const end = offset + length;
  if (end > bytes.length) {
    throw new Error("Invalid ASN.1 octet length");
  }

  return bytes.slice(offset, end);
}

function extractEd25519SeedFromPkcs8(pkcs8: Uint8Array): Uint8Array {
  let offset = 0;

  function expectTag(tag: number): number {
    if (pkcs8[offset] !== tag) {
      throw new Error(`Unexpected ASN.1 tag 0x${pkcs8[offset]?.toString(16) ?? "??"}`);
    }
    offset += 1;
    return readLength();
  }

  function readLength(): number {
    if (offset >= pkcs8.length) {
      throw new Error("ASN.1 truncated");
    }
    let length = pkcs8[offset];
    offset += 1;
    if ((length & 0x80) === 0) {
      return length;
    }
    const lengthBytes = length & 0x7f;
    if (lengthBytes === 0 || lengthBytes > 4 || offset + lengthBytes > pkcs8.length) {
      throw new Error("Invalid ASN.1 length encoding");
    }
    length = 0;
    for (let i = 0; i < lengthBytes; i += 1) {
      length = (length << 8) | pkcs8[offset + i];
    }
    offset += lengthBytes;
    return length;
  }

  const outerLength = expectTag(0x30);
  const outerEnd = offset + outerLength;
  if (outerEnd > pkcs8.length) {
    throw new Error("ASN.1 truncated outer sequence");
  }

  const versionLength = expectTag(0x02);
  offset += versionLength;

  const algLength = expectTag(0x30);
  const algEnd = offset + algLength;
  const oidLength = expectTag(0x06);
  if (offset + oidLength > pkcs8.length) {
    throw new Error("ASN.1 truncated OID");
  }
  const oidBytes = pkcs8.slice(offset, offset + oidLength);
  offset += oidLength;
  const OID_ED25519 = "2b6570";
  const oidHex = Array.from(oidBytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (oidHex !== OID_ED25519) {
    throw new Error(`Unexpected OID ${oidHex}`);
  }
  offset = algEnd;

  const privateKeyLength = expectTag(0x04);
  if (offset + privateKeyLength > pkcs8.length) {
    throw new Error("ASN.1 truncated private key");
  }
  const privateKeyBytes = pkcs8.slice(offset, offset + privateKeyLength);
  offset += privateKeyLength;

  const seed = extractInnerOctet(privateKeyBytes);
  if (seed.length !== 32 && seed.length !== 64) {
    throw new Error(`Unexpected seed length ${seed.length}`);
  }

  // Skip optional public key (context-specific 1) if present without failing.
  if (offset < outerEnd && pkcs8[offset] === 0xa1) {
    const publicKeyLength = expectTag(0xa1);
    offset += publicKeyLength;
  }

  return seed.slice(0, 32);
}

function parsePemSecret(secret: string): Uint8Array {
  const normalized = secret
    .replace(/-----BEGIN ED25519 PRIVATE KEY-----/g, "-----BEGIN PRIVATE KEY-----")
    .replace(/-----END ED25519 PRIVATE KEY-----/g, "-----END PRIVATE KEY-----");

  const match = normalized.match(/-----BEGIN PRIVATE KEY-----([\s\S]+?)-----END PRIVATE KEY-----/);
  if (!match) {
    throw new Error("PEM boundaries not found");
  }

  const base64Body = match[1].replace(/[^A-Za-z0-9+/=_-]/g, "");
  const pkcs8 = decodeBase64Flexible(base64Body);
  return extractEd25519SeedFromPkcs8(pkcs8);
}

function parsePrivateKey(raw: string): Uint8Array {
  const normalized = normalizeSecret(raw);
  if (!normalized) {
    console.error("JWT_PRIVATE_KEY secret is empty or missing");
    throw new HttpError(500, "jwt_config_missing", "JWT private key is not configured");
  }

  if (/-----BEGIN OPENSSH PRIVATE KEY-----/.test(normalized)) {
    console.error("OpenSSH format not supported; need PKCS#8");
    throw new HttpError(500, "jwt_key_openssh", "JWT private key must be PKCS#8 Ed25519");
  }

  if (/-----BEGIN [^-]+-----/.test(normalized)) {
    if (
      !/-----BEGIN (?:ED25519 )?PRIVATE KEY-----/.test(normalized) ||
      !/-----END (?:ED25519 )?PRIVATE KEY-----/.test(normalized)
    ) {
      console.error("Unsupported PEM header for JWT private key");
      throw new HttpError(500, "jwt_key_pem_header", "JWT private key PEM header is not supported");
    }

    try {
      return parsePemSecret(normalized);
    } catch (error) {
      console.error("Failed to parse PKCS#8 JWT private key", error);
      throw new HttpError(500, "jwt_key_pkcs8_parse", "JWT private key PEM is invalid");
    }
  }

  try {
    const bytes = decodeBase64Flexible(normalized);
    if (bytes.length !== 32 && bytes.length !== 64) {
      console.error(`JWT private key length ${bytes.length} unsupported`);
      throw new HttpError(500, "jwt_key_length_invalid", "JWT private key must be 32 or 64 bytes");
    }
    return bytes;
  } catch (error) {
    console.error("Failed to decode JWT private key secret", error);
    throw new HttpError(500, "jwt_key_decode_failed", "JWT private key is invalid");
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
        console.error(`JWT private key length ${privateKey.length} unsupported after parsing`);
        throw new HttpError(500, "jwt_key_length_invalid", "JWT private key must be 32 or 64 bytes");
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

const TRIAL_LIFETIME_SECONDS = 15 * 60;

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

export async function issueTrialToken(env: Env, userId: string): Promise<LicenseTokenResult> {
  const { privateKey } = await getSigningMaterial(env);
  const header = {
    alg: "EdDSA",
    typ: "JWT",
  };

  const issuedAt = Math.floor(Date.now() / 1000);
  const exp = issuedAt + TRIAL_LIFETIME_SECONDS;
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

export async function verifyTrialToken(env: Env, token: string): Promise<TrialClaims> {
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

  const payload = JSON.parse(new TextDecoder().decode(payloadBytes)) as TrialClaims;
  if (!payload || payload.trial !== true || payload.use !== 1) {
    throw new HttpError(401, "invalid_token", "Token payload is invalid");
  }
  if (typeof payload.sub !== "string" || payload.sub.trim().length === 0) {
    throw new HttpError(401, "invalid_token", "Token subject is invalid");
  }
  if (typeof payload.jti !== "string" || payload.jti.trim().length === 0) {
    throw new HttpError(401, "invalid_token", "Token identifier is invalid");
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp <= now) {
    throw new HttpError(401, "token_expired", "Token is expired");
  }

  return payload;
}

export async function revokeLicenseToken(env: Env, jti: string, ttlSeconds: number): Promise<void> {
  await markTokenRevoked(env, jti, ttlSeconds);
}
