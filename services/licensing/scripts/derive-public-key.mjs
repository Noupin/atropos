#!/usr/bin/env node
import { getPublicKey } from "@noble/ed25519";

function usage() {
  console.error("Usage: npm run derive-public-key -- [base64-private-key] [kid]");
  console.error(
    "Provide the base64-encoded 32-byte Ed25519 private key as an argument, via JWT_PRIVATE_KEY, or select a kid from JWT_PRIVATE_KEYS/JWT_ACTIVE_KID."
  );
}

function base64ToUint8Array(value) {
  try {
    return Uint8Array.from(Buffer.from(value, "base64"));
  } catch (error) {
    console.error("Failed to decode base64 private key:", error.message);
    process.exit(1);
  }
}

function resolvePrivateKey() {
  const argKey = process.argv[2];
  if (argKey && !argKey.startsWith("--")) {
    return argKey;
  }

  if (process.env.JWT_PRIVATE_KEY) {
    return process.env.JWT_PRIVATE_KEY;
  }

  if (process.env.JWT_PRIVATE_KEYS) {
    try {
      const mapping = JSON.parse(process.env.JWT_PRIVATE_KEYS);
      const kid = process.argv[3] ?? process.env.JWT_ACTIVE_KID;
      if (!kid) {
        console.error("Multiple keys configured. Specify a kid argument or set JWT_ACTIVE_KID.");
        process.exit(1);
      }
      if (!(kid in mapping)) {
        console.error(`Key id ${kid} not found in JWT_PRIVATE_KEYS.`);
        process.exit(1);
      }
      return mapping[kid];
    } catch (error) {
      console.error("Failed to parse JWT_PRIVATE_KEYS:", error.message);
      process.exit(1);
    }
  }

  return null;
}

const resolved = resolvePrivateKey();
if (!resolved) {
  usage();
  process.exit(1);
}

const privateKey = base64ToUint8Array(resolved.trim());
if (privateKey.length !== 32 && privateKey.length !== 64) {
  console.error("Private key must be 32 or 64 bytes after base64 decoding.");
  process.exit(1);
}

const publicKey = await getPublicKey(privateKey.slice(0, 32));
const publicKeyBase64 = Buffer.from(publicKey).toString("base64url");
console.log(publicKeyBase64);
