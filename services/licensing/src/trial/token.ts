const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface TrialTokenPayload {
  trial: boolean;
  jti: string;
  exp: number;
}

const base64UrlEncode = (input: string | Uint8Array): string => {
  let bytes: Uint8Array;

  if (typeof input === "string") {
    bytes = textEncoder.encode(input);
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

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
};

export const encodeTrialToken = (payload: TrialTokenPayload): string => {
  return base64UrlEncode(JSON.stringify(payload));
};

export const decodeTrialToken = (token: string): TrialTokenPayload => {
  let decoded: Uint8Array;

  try {
    decoded = base64UrlDecode(token);
  } catch (error) {
    throw new Error("invalid_token_format");
  }

  let json: string;

  try {
    json = textDecoder.decode(decoded);
  } catch (error) {
    throw new Error("invalid_token_payload");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new Error("invalid_token_payload");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("invalid_token_payload");
  }

  const candidate = parsed as Record<string, unknown>;
  const trial = candidate.trial === true;
  const jti = typeof candidate.jti === "string" ? candidate.jti : null;
  const exp = typeof candidate.exp === "number" ? candidate.exp : null;

  if (!trial || !jti || !exp) {
    throw new Error("invalid_token_payload");
  }

  return { trial, jti, exp };
};

export const generateTrialJti = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return base64UrlEncode(bytes);
};
