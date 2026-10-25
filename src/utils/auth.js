const { createHash, randomBytes, timingSafeEqual } = require(`crypto`);
const fs = require(`node:fs/promises`);
const path = require(`node:path`);
const { sessionLifetime } = require(`../config`);

const userDirectory = path.join(__dirname, `..`, `..`, `db`, `usr`);

function missingConfiguration(...values) {
  return values.some((value) => !value);
}

function createSessionToken(userId) {
  return `${userId}.${randomBytes(32).toString(`base64url`)}`;
}

function hashSessionToken(token) {
  return createHash(`sha256`).update(token).digest(`hex`);
}

function getBearerToken(req) {
  const authorization = req.get(`authorization`);

  if (!authorization?.startsWith(`Bearer `)) {
    return null;
  }

  const token = authorization.slice(`Bearer `.length).trim();
  return token || null;
}

async function verifyUserToken(token) {
  if (typeof token !== `string`) {
    return null;
  }

  const separator = token.indexOf(`.`);
  const userId = separator === -1 ? null : token.slice(0, separator);
  const tokenSecret = separator === -1 ? null : token.slice(separator + 1);

  if (!/^\d+$/.test(userId || ``) || !tokenSecret) {
    return null;
  }

  const userPath = path.join(userDirectory, `${userId}.json`);

  try {
    const storedUser = JSON.parse(await fs.readFile(userPath, `utf8`));
    const storedHash = Buffer.from(storedUser.sessionTokenHash || ``, `hex`);
    const providedHash = Buffer.from(hashSessionToken(token), `hex`);

    if (
      storedHash.length !== providedHash.length ||
      !timingSafeEqual(storedHash, providedHash) ||
      !storedUser.sessionTokenExpiresAt ||
      Date.parse(storedUser.sessionTokenExpiresAt) <= Date.now()
    ) {
      return null;
    }

    return {
      id: userId,
      username: storedUser.username,
      avatar: storedUser.avatar,
      aToken: storedUser.aToken,
      rToken: storedUser.rToken,
    };
  } catch {
    return null;
  }
}

async function getUserDataFromToken(sessionToken) {
  return verifyUserToken(sessionToken);
}

async function saveUserData(
  refreshToken,
  accessToken,
  userId,
  username,
  avatar,
  sessionToken,
) {
  const userPath = path.join(userDirectory, `${userId}.json`);
  const data = {
    rToken: refreshToken,
    aToken: accessToken,
    username,
    avatar,
    sessionTokenHash: hashSessionToken(sessionToken),
    sessionTokenExpiresAt: new Date(Date.now() + sessionLifetime).toISOString(),
  };

  await fs.mkdir(userDirectory, { recursive: true });
  await fs.writeFile(userPath, JSON.stringify(data, null, 2), `utf8`);
}

module.exports = {
  createSessionToken,
  getBearerToken,
  getUserDataFromToken,
  hashSessionToken,
  missingConfiguration,
  saveUserData,
  verifyUserToken,
};
