/**
 * Shared mock for @vector-im/matrix-bot-sdk.
 *
 * The Matrix bot SDK transitively requires the native Rust crypto addon
 * (@matrix-org/matrix-sdk-crypto-nodejs) via its CryptoClient module.
 * When the platform-specific binary is not installed, importing the SDK
 * fails at module load time. This mock provides the minimal surface
 * needed by the extension's non-crypto code paths so that unit tests
 * can run without the native addon.
 */

import { vi } from "vitest";

const noop = () => {};

export class ConsoleLogger {
  trace = noop;
  debug = noop;
  info = noop;
  warn = noop;
  error = noop;
}

export const LogService = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  setLevel: noop,
  setLogger: noop,
};

export const LogLevel = {
  DEBUG: "DEBUG",
  INFO: "INFO",
  WARN: "WARN",
  ERROR: "ERROR",
  TRACE: "TRACE",
};

export class MatrixClient {
  constructor(..._args: unknown[]) {}
  getUserId = vi.fn().mockResolvedValue("@mock:example.org");
  start = vi.fn().mockResolvedValue(undefined);
  stop = vi.fn();
  on = vi.fn();
  sendMessage = vi.fn().mockResolvedValue("mock-event-id");
  sendEvent = vi.fn().mockResolvedValue("mock-event-id");
  sendStateEvent = vi.fn().mockResolvedValue("mock-event-id");
  sendReadReceipt = vi.fn().mockResolvedValue(undefined);
  getJoinedRooms = vi.fn().mockResolvedValue([]);
  joinRoom = vi.fn().mockResolvedValue("!mock:example.org");
  resolveRoom = vi.fn().mockResolvedValue("!mock:example.org");
  getRoomMembers = vi.fn().mockResolvedValue([]);
}

export class SimpleFsStorageProvider {
  constructor(..._args: unknown[]) {}
}

export class RustSdkCryptoStorageProvider {
  constructor(..._args: unknown[]) {}
}

export class AutojoinRoomsMixin {
  static setupOnClient = vi.fn();
}
