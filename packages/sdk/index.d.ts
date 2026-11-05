export interface Identity {
  secret: string;
  key: string;
}
export interface Packet {
  body: string;
  signature: string;
}
export type Capability = "device.health" | "camera.snapshot";
export type Response = { id: string; to: string; challenge: string } & (
  | {
      type: "register";
      capabilities: Capability[];
      version: 1;
      streams: string[];
    }
  | {
      type: "result";
      ok: true;
      value:
        | { status: "ok"; platform: string }
        | { mime: "image/jpeg"; data: string };
    }
  | { type: "result"; ok: false; error: "denied" | "hardware_unavailable" }
);
export function nonce(): string;
export function identity(): Identity;
export function publicKey(key: string): import("node:crypto").KeyObject;
export function localAddress(host: string): boolean;
export function privateOrigin(value: string): string;
export function seal(data: unknown, secret: string): Packet;
export function open(packet: Packet, key: string): unknown;
export function call(
  origin: string,
  self: Identity,
  device: string,
  capability?: Capability,
  fetcher?: typeof fetch,
): Promise<Response>;
