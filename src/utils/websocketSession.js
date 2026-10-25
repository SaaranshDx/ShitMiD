const { randomBytes } = require(`crypto`);
const fs = require(`node:fs/promises`);
const path = require(`node:path`);

const userDirectory = path.join(__dirname, `..`, `..`, `db`, `usr`);

function createSessionId() {
  // Nine bytes produce exactly twelve base64url characters.
  return randomBytes(9).toString(`base64url`);
}

async function createWebSocketSession(userId, username) {
  const sessionId = createSessionId();
  const sessionDirectory = path.join(userDirectory, userId);
  const sessionPath = path.join(sessionDirectory, `${sessionId}.json`);
  const connectedAtMs = Date.now();
  const data = {
    sessionId,
    userId,
    username,
    status: `connected`,
    connectedAt: new Date(connectedAtMs).toISOString(),
    disconnectedAt: null,
    durationMs: null,
    closeCode: null,
    closeReason: null,
  };

  await fs.mkdir(sessionDirectory, { recursive: true });
  await fs.writeFile(sessionPath, JSON.stringify(data, null, 2), `utf8`);

  return {
    connectedAtMs,
    data,
    sessionPath,
  };
}

async function closeWebSocketSession(session, closeCode, closeReason) {
  const disconnectedAtMs = Date.now();
  const data = {
    ...session.data,
    status: `closed`,
    disconnectedAt: new Date(disconnectedAtMs).toISOString(),
    durationMs: disconnectedAtMs - session.connectedAtMs,
    closeCode,
    closeReason,
  };

  await fs.writeFile(session.sessionPath, JSON.stringify(data, null, 2), `utf8`);
  return data;
}

module.exports = {
  closeWebSocketSession,
  createWebSocketSession,
};
