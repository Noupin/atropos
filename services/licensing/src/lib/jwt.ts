const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const base64UrlEncode = (input: Uint8Array | ArrayBuffer | string): string => {
  let bytes: Uint8Array;

  if (typeof input === "string") {
    bytes = textEncoder.encode(input);
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else {
    bytes = input;
  }

  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
};

const base64UrlDecode = (input: string): Uint8Array => {
  const sanitized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = sanitized.length % 4 === 0 ? 0 : 4 - (sanitized.length % 4);
  const base64 = sanitized + "=".repeat(padding);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
};

const parsePrivateKey = (value: string): JsonWebKey => {
  let parsed: JsonWebKey;

  try {
    parsed = JSON.parse(value) as JsonWebKey;
  } catch (error) {
    throw new Error("JWT_PRIVATE_KEY must be a JSON Web Key string");
  }

  if (parsed.kty !== "OKP" || parsed.crv !== "Ed25519") {
    throw new Error("JWT_PRIVATE_KEY must be an Ed25519 OKP JWK");
  }

  if (typeof parsed.d !== "string" || typeof parsed.x !== "string") {
    throw new Error("JWT_PRIVATE_KEY must include both private (d) and public (x) components");
  }

  return parsed;
};

export interface SigningMaterial {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: JsonWebKey;
}

let cachedKey: string | null = null;
let cachedMaterial: SigningMaterial | null = null;

export const getSigningMaterial = async (
  env: { JWT_PRIVATE_KEY?: string } & Record<string, unknown>,
): Promise<SigningMaterial> => {
  const rawKey = env.JWT_PRIVATE_KEY;

  if (typeof rawKey !== "string" || rawKey.trim().length === 0) {
    throw new Error("JWT_PRIVATE_KEY is not configured");
  }

  if (cachedMaterial && cachedKey === rawKey) {
    return cachedMaterial;
  }

  const jwk = parsePrivateKey(rawKey);
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);

  const publicJwk: JsonWebKey = {
    kty: "OKP",
    crv: "Ed25519",
    x: jwk.x,
  };

  if (jwk.kid) {
    publicJwk.kid = jwk.kid;
  }

  const publicKey = await crypto.subtle.importKey("jwk", publicJwk, { name: "Ed25519" }, false, ["verify"]);

  cachedKey = rawKey;
  cachedMaterial = { privateKey, publicKey, publicJwk };

  return cachedMaterial;
};

export const signJwt = async (
  payload: Record<string, unknown>,
  material: SigningMaterial,
): Promise<string> => {
  const header = { alg: "EdDSA", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = await crypto.subtle.sign("Ed25519", material.privateKey, textEncoder.encode(signingInput));
  const encodedSignature = base64UrlEncode(signature);

  return `${signingInput}.${encodedSignature}`;
};

export interface JwtVerificationResult {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}

const decodeSegment = (segment: string): Record<string, unknown> => {
  const decoded = base64UrlDecode(segment);
  const json = textDecoder.decode(decoded);

  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error("Invalid JWT segment encoding");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid JWT segment payload");
  }

  return parsed as Record<string, unknown>;
};

export const verifyJwt = async (
  token: string,
  material: SigningMaterial,
): Promise<JwtVerificationResult> => {
  const parts = token.split(".");

  if (parts.length !== 3) {
    throw new Error("Invalid token format");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeSegment(encodedHeader);
  const payload = decodeSegment(encodedPayload);

  if (header.alg && header.alg !== "EdDSA") {
    throw new Error("Unsupported JWT algorithm");
  }

  const signature = base64UrlDecode(encodedSignature);
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const isValid = await crypto.subtle.verify(
    "Ed25519",
    material.publicKey,
    signature,
    textEncoder.encode(signingInput),
  );

  if (!isValid) {
    throw new Error("Invalid token signature");
  }

  return { header, payload };
};

export const getPublicKeyResponse = async (
  env: { JWT_PRIVATE_KEY?: string } & Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const material = await getSigningMaterial(env);
  const { publicJwk } = material;

  return {
    alg: "EdDSA",
    kty: publicJwk.kty,
    crv: publicJwk.crv,
    x: publicJwk.x,
    ...(publicJwk.kid ? { kid: publicJwk.kid } : {}),
  };
};
