import type { KVNamespace, UserRecord } from "../kv";
import {
  getDeviceRecord,
  linkLegacyUserId,
  resolveRecordByLegacyUserId,
} from "../kv";

const toNonEmptyString = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export interface IdentityResolutionInput {
  deviceHash?: unknown;
  legacyUserId?: unknown;
}

export interface IdentityResolutionResult {
  deviceHash: string | null;
  legacyUserId: string | null;
  record: UserRecord | null;
  mappedFromLegacy: boolean;
}

export const resolveIdentity = async (
  kv: KVNamespace,
  input: IdentityResolutionInput,
): Promise<IdentityResolutionResult> => {
  const requestedDeviceHash = toNonEmptyString(input.deviceHash);
  const legacyUserId = toNonEmptyString(input.legacyUserId);

  if (requestedDeviceHash) {
    const record = await getDeviceRecord(kv, requestedDeviceHash);
    if (legacyUserId && requestedDeviceHash) {
      await linkLegacyUserId(kv, legacyUserId, requestedDeviceHash);
    }
    return {
      deviceHash: requestedDeviceHash,
      legacyUserId,
      record,
      mappedFromLegacy: false,
    };
  }

  if (legacyUserId) {
    const { deviceHash, record } = await resolveRecordByLegacyUserId(kv, legacyUserId);
    if (deviceHash) {
      await linkLegacyUserId(kv, legacyUserId, deviceHash);
    }
    return {
      deviceHash: deviceHash ?? null,
      legacyUserId,
      record,
      mappedFromLegacy: Boolean(deviceHash),
    };
  }

  return {
    deviceHash: null,
    legacyUserId: null,
    record: null,
    mappedFromLegacy: false,
  };
};
