const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { WebSocketServer, WebSocket } = require("ws");
const { getUserDataFromToken } = require("../utils/auth");

const SESSION_PATH = "/session";
const AUTH_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_PAYLOAD_BYTES = 16 * 1024;
const recordsPath = path.join(__dirname, "..", "..", "db", "telemetry", "sessions.jsonl");

function send(socket, type, data = {}) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ v: 1, type, data }));
  }
}

async function appendRecord(record) {
  await fs.mkdir(path.dirname(recordsPath), { recursive: true });
  await fs.appendFile(recordsPath, `${JSON.stringify(record)}\n`, "utf8");
}

function attachSessionWebSocket(server) {
  const wss = new WebSocketServer({
    server,
    path: SESSION_PATH,
    maxPayload: MAX_PAYLOAD_BYTES,
    perMessageDeflate: false,
  });

  wss.on("connection", (socket) => {
    let authenticated = false;
    let finalized = false;
    let userId = null;
    let sessionId = null;
    let startedAt = null;
    let startedMono = null;
    let bytesReceived = 0;
    let bytesSent = 0;
    let alive = true;

    const authTimer = setTimeout(() => {
      if (!authenticated) {
        send(socket, "auth_error", { code: "AUTH_TIMEOUT", message: "Authenticate within 10 seconds." });
        socket.close(4401, "Authentication timeout");
      }
    }, AUTH_TIMEOUT_MS);
    authTimer.unref?.();

    const heartbeat = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref?.();

    socket.on("pong", () => {
      alive = true;
    });

    // Count application payload bytes only, not WebSocket framing/TCP/TLS overhead.
    socket.on("message", async (raw, isBinary) => {
      bytesReceived += raw.length;

      if (isBinary) {
        send(socket, "error", { code: "TEXT_ONLY", message: "STP v1 accepts JSON text frames only." });
        socket.close(4400, "Text frames required");
        return;
      }

      let message;
      try {
        message = JSON.parse(raw.toString("utf8"));
      } catch {
        send(socket, "error", { code: "INVALID_JSON", message: "Message must be valid JSON." });
        socket.close(4400, "Invalid JSON");
        return;
      }

      if (!message || message.v !== 1 || typeof message.type !== "string") {
        send(socket, "error", { code: "INVALID_ENVELOPE", message: "Expected STP v1 envelope." });
        socket.close(4400, "Invalid envelope");
        return;
      }

      if (!authenticated) {
        if (message.type !== "authenticate" || typeof message.data?.token !== "string") {
          send(socket, "auth_error", { code: "AUTH_REQUIRED", message: "Send an authenticate message first." });
          socket.close(4401, "Authentication required");
          return;
        }

        let user;
        try {
          user = await getUserDataFromToken(message.data.token);
        } catch {
          user = null;
        }

        if (!user?.id) {
          send(socket, "auth_error", { code: "INVALID_TOKEN", message: "Session token is invalid or expired." });
          socket.close(4401, "Invalid session token");
          return;
        }

        authenticated = true;
        clearTimeout(authTimer);
        userId = user.id;
        sessionId = randomUUID();
        startedAt = new Date().toISOString();
        startedMono = process.hrtime.bigint();

        send(socket, "authenticated", {
          session_id: sessionId,
          started_at: startedAt,
          heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
          protocol: "STP",
          version: 1,
        });
        return;
      }

      if (message.type === "ping") {
        send(socket, "pong", { ts: Date.now() });
        return;
      }

      if (message.type === "close") {
        socket.close(1000, "Client requested close");
        return;
      }

      send(socket, "error", { code: "UNKNOWN_MESSAGE", message: "Unknown message type." });
      socket.close(4400, "Unknown message type");
    });

    socket.on("send", (data) => {
      if (Buffer.isBuffer(data)) bytesSent += data.length;
      else if (typeof data === "string") bytesSent += Buffer.byteLength(data);
    });

    socket.on("close", (code, reason) => {
      void finalize(code, reason.toString("utf8"));
    });

    socket.on("error", (error) => {
      console.error("Session WebSocket error:", error.message);
    });

    async function finalize(closeCode, closeReason) {
      if (finalized) return;
      finalized = true;
      clearTimeout(authTimer);
      clearInterval(heartbeat);

      if (!authenticated || !startedMono) return;

      const endedAt = new Date().toISOString();
      const durationMs = Number(process.hrtime.bigint() - startedMono) / 1e6;
      const record = {
        session_id: sessionId,
        user_id: userId,
        started_at: startedAt,
        ended_at: endedAt,
        duration_ms: Math.round(durationMs),
        bytes_received: bytesReceived,
        bytes_sent: bytesSent,
        close_code: closeCode,
        close_reason: closeReason.slice(0, 120),
      };

      try {
        await appendRecord(record);
      } catch (error) {
        console.error("Failed to persist session telemetry:", error.message);
      }
    }
  });

  return wss;
}

module.exports = { attachSessionWebSocket, SESSION_PATH };
