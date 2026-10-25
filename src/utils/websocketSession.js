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

function getSessionDuration(session) {
  if (Number.isFinite(session.durationMs)) {
    return Math.max(0, session.durationMs);
  }

  if (session.status === `connected`) {
    const connectedAtMs = Date.parse(session.connectedAt);

    if (!Number.isNaN(connectedAtMs)) {
      return Math.max(0, Date.now() - connectedAtMs);
    }
  }

  return 0;
}

async function getLeaderboard(page, pageSize) {
  let userDirectories;

  try {
    userDirectories = await fs.readdir(userDirectory, { withFileTypes: true });
  } catch (error) {
    if (error.code === `ENOENT`) {
      return {
        page,
        pageSize,
        totalUsers: 0,
        totalPages: 0,
        hasNextPage: false,
        hasPreviousPage: page > 1,
        users: [],
      };
    }

    throw error;
  }

  const sessionLists = await Promise.all(
    userDirectories
      .filter((entry) => entry.isDirectory())
      .map(async (userDirectoryEntry) => {
        const sessionDirectory = path.join(
          userDirectory,
          userDirectoryEntry.name,
        );
        const sessionFiles = await fs.readdir(sessionDirectory, {
          withFileTypes: true,
        });

        return Promise.all(
          sessionFiles
            .filter(
              (entry) => entry.isFile() && entry.name.endsWith(`.json`),
            )
            .map(async (sessionFile) => {
              try {
                const sessionPath = path.join(
                  sessionDirectory,
                  sessionFile.name,
                );
                return JSON.parse(await fs.readFile(sessionPath, `utf8`));
              } catch {
                return null;
              }
            }),
        );
      }),
  );

  const longestSessionByUser = new Map();

  for (const sessions of sessionLists.flat()) {
    if (!sessions?.userId) {
      continue;
    }

    const session = {
      ...sessions,
      durationMs: getSessionDuration(sessions),
    };
    const currentLongest = longestSessionByUser.get(String(session.userId));

    if (!currentLongest || session.durationMs > currentLongest.durationMs) {
      longestSessionByUser.set(String(session.userId), session);
    }
  }

  const users = [...longestSessionByUser.values()].sort(
    (first, second) => second.durationMs - first.durationMs,
  );
  const offset = (page - 1) * pageSize;
  const totalUsers = users.length;
  const totalPages = Math.ceil(totalUsers / pageSize);

  return {
    page,
    pageSize,
    totalUsers,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
    users: users
      .slice(offset, offset + pageSize)
      .map((user, index) => ({
        rank: offset + index + 1,
        ...user,
      })),
  };
}

module.exports = {
  closeWebSocketSession,
  createWebSocketSession,
  getLeaderboard,
};
