#!/usr/bin/env node
import { getPublicKey } from "@noble/ed25519";

function usage() {
  console.error("Usage: npm run derive-public-key -- <base64-private-key>");
  console.error("Provide the base64-encoded 32-byte Ed25519 private key as an argument or via JWT_PRIVATE_KEY env var.");
}

function base64ToUint8Array(value) {
  try {
    return Uint8Array.from(Buffer.from(value, "base64"));
  } catch (error) {
    console.error("Failed to decode base64 private key:", error.message);
    process.exit(1);
  }
}

const input = process.argv[2] ?? process.env.JWT_PRIVATE_KEY;
if (!input) {
  usage();
  process.exit(1);
}

const privateKey = base64ToUint8Array(input.trim());
if (privateKey.length !== 32 && privateKey.length !== 64) {
  console.error("Private key must be 32 or 64 bytes after base64 decoding.");
  process.exit(1);
}

const publicKey = await getPublicKey(privateKey.slice(0, 32));
const publicKeyBase64 = Buffer.from(publicKey).toString("base64url");
console.log(publicKeyBase64);
