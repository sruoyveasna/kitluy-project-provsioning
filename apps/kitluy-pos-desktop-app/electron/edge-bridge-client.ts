/**
 * The POS side of the edge bridge — T1-STORE-OPERATIONS-001.
 *
 * On a KitLuy Pi Terminal the POS never opens a TLS connection to the Store
 * Hub. `kitluy-terminal-edge.service` (root) holds the operational key, pins the
 * verified Hub certificate and forwards a CLOSED list of Hub routes from a unix
 * socket that only the `kitluy-terminal` group can reach
 * (`services/kitluy-device-firstboot-agent/src/edge-bridge.ts`).
 *
 * This module is plain HTTP over that socket and nothing else: no key, no
 * certificate, no host name. A bridge that cannot be reached THROWS, which the
 * bootstrap reports as `hub_unavailable` — never as a successful empty answer.
 */
import { request } from "node:http";

import type { EdgeBridgeStatusWire } from "../src/bootstrap/edge-machine.js";
import type { HubCall } from "./edge-operations-session.js";

export const DEFAULT_EDGE_BRIDGE_SOCKET = "/run/kitluy-terminal-edge/bridge.sock";
export const BRIDGE_STATUS_PATH = "/bridge/v1/status";
/** A Hub answer larger than this is refused before it is buffered. */
const MAX_RESPONSE_BYTES = 1024 * 1024;

export class EdgeBridgeError extends Error {
  constructor(message: string) {
    super(`KLUY-TERMINAL-EDGE-BRIDGE: ${message}`);
    this.name = "EdgeBridgeError";
  }
}

export function bridgeCall(socketPath: string, timeoutMs = 15_000): HubCall {
  return (method, path, body, headers) =>
    new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), "utf8");
      const req = request(
        {
          socketPath,
          method,
          path,
          timeout: timeoutMs,
          headers: {
            ...(headers ?? {}),
            ...(payload === undefined
              ? {}
              : {
                  "content-type": "application/json",
                  "content-length": String(payload.length),
                }),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_RESPONSE_BYTES) {
              req.destroy(new EdgeBridgeError("the bridge answer is too large"));
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let parsed: unknown = null;
            if (text.length > 0) {
              try {
                parsed = JSON.parse(text) as unknown;
              } catch {
                reject(new EdgeBridgeError("the bridge answered with a non-JSON body"));
                return;
              }
            }
            resolve({ status: response.statusCode ?? 0, body: parsed });
          });
        },
      );
      req.on("timeout", () => {
        req.destroy(new EdgeBridgeError("the bridge did not answer in time"));
      });
      req.on("error", (error) => {
        reject(
          error instanceof EdgeBridgeError
            ? error
            : new EdgeBridgeError(`the bridge could not be reached (${error.message})`),
        );
      });
      if (payload !== undefined) req.write(payload);
      req.end();
    });
}

/** The bridge's status. THROWS when unreachable or malformed. */
export async function readBridgeStatus(socketPath: string): Promise<EdgeBridgeStatusWire> {
  const response = await bridgeCall(socketPath, 5_000)("GET", BRIDGE_STATUS_PATH);
  const body = response.body as Partial<EdgeBridgeStatusWire> | null;
  if (response.status !== 200 || body === null || typeof body.terminal !== "object") {
    throw new EdgeBridgeError(`the bridge status answered ${String(response.status)}`);
  }
  return body as EdgeBridgeStatusWire;
}
