require(`dotenv`).config();
const express = require(`express`);
const { URLSearchParams } = require(`url`);
const { createHash, randomBytes, timingSafeEqual } = require(`crypto`);
const axios = require(`axios`);
const fs = require(`node:fs/promises`);
const path = require(`node:path`);
require('crypto');

const port = process.env.PORT || 8000;
const clientId = process.env.CLIENTID;
const clientSecret = process.env.CLIENTSECRET;
const redirectUri =
  process.env.DISCORD_REDIRECT_URI ||
  `http://localhost:${port}/auth/discord/redirect`;
const scope =
  process.env.DISCORD_SCOPE ||
  `guilds.join rpc.video.read rpc.screenshare.write rpc.video.write rpc.activities.write rpc.voice.write rpc.screenshare.read identify rpc.voice.read rpc.notifications.read rpc`;
const stateLifetime = 10 * 60 * 1000;
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;
const pendingStates = new Map();
const app = express();

function missingConfiguration(...values) {
  return values.some((value) => !value);
}

// Start OAuth from this route so the redirect URI and state are always consistent.
app.get(`/auth/discord`, (req, res) => {
  if (missingConfiguration(clientId, redirectUri)) {
    return res.status(500).send(`Discord OAuth is not configured`);
  }

  const state = randomBytes(32).toString(`hex`);
  const expiry = setTimeout(() => pendingStates.delete(state), stateLifetime);
  expiry.unref?.();
  pendingStates.set(state, expiry);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: `code`,
    redirect_uri: redirectUri,
    scope,
    state,
  });

  return res.redirect(
    `https://discord.com/oauth2/authorize?${params.toString()}`,
  );
});

app.get(`/auth/discord/redirect`, async (req, res) => {
  const { code, state, error, error_description: errorDescription } = req.query;

  if (error) {
    return res
      .status(400)
      .send(`Discord authorization failed: ${errorDescription || error}`);
  }

  if (typeof code !== `string`) {
    return res.status(400).send(`Missing OAuth authorization code`);
  }

  if (typeof state !== `string` || !pendingStates.has(state)) {
    return res.status(400).send(`Invalid or expired OAuth state`);
  }

  clearTimeout(pendingStates.get(state));
  pendingStates.delete(state);

  if (missingConfiguration(clientId, clientSecret, redirectUri)) {
    return res.status(500).send(`Discord OAuth is not configured`);
  }

  const formData = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: `authorization_code`,
    code,
    redirect_uri: redirectUri,
  });

  let tokenResponse;
  try {
    tokenResponse = await axios.post(
      `https://discord.com/api/v10/oauth2/token`,
      formData.toString(),
      {
        headers: {
          'Content-Type': `application/x-www-form-urlencoded`,
        },
      },
    );
  } catch (error) {
    const discordError = error.response?.data?.error;

    if (discordError === `invalid_grant`) {
      return res
        .status(400)
        .send(
          `Discord rejected the authorization code. Start the login again at /auth/discord.`,
        );
    }

    console.error(
      `Discord token exchange failed:`,
      discordError || error.message,
    );
    return res.status(502).send(`Discord token exchange failed`);
  }

  try {
    const userResponse = await axios.get(
      `https://discord.com/api/v10/users/@me`,
      {
        headers: {
          Authorization: `Bearer ${tokenResponse.data.access_token}`,
        },
      },
    );

    const user = userResponse.data;
    const avatarUrl = user.avatar
      ? `https://cdn.discordapp.com/avatars/${user.id}/${encodeURIComponent(user.avatar)}.webp?size=4096`
      : null;
    const sessionToken = createSessionToken(user.id);

    try {
      await saveUserData(
        tokenResponse.data.refresh_token,
        tokenResponse.data.access_token,
        user.id,
        user.username,
        avatarUrl,
        sessionToken,
      );
    } catch (error) {
      console.error(`Failed to save Discord user:`, error.message);
      return res.status(500).send(`Failed to save Discord user`);
    }

    // Do not log or return the access token.
    return res.json({
      message: `Discord authorization successful`,
      token: sessionToken,
      user,
    });
  } catch (error) {
    console.error(`Discord user lookup failed:`, error.message);
    return res.status(502).send(`Discord user lookup failed`);
  }
});

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

  const userPath = path.join(__dirname, `..`, `db`, `usr`, `${userId}.json`);

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

app.get(`/auth/verify`, async (req, res) => {
  const user = await getUserDataFromToken(getBearerToken(req));

  if (!user) {
    return res.status(401).json({
      authenticated: false,
      message: `Invalid or expired token`,
    });
  }

  const { aToken, rToken, ...safeUser } = user;

  return res.json({
    authenticated: true,
    user: safeUser,
  });
});

async function saveUserData(
  refreshToken,
  accessToken,
  userId,
  username,
  avatar,
  sessionToken,
) {
  const userDirectory = path.join(__dirname, `..`, `db`, `usr`);
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

// shitmid guild join endpoint
app.post('/api/joinguild', async (req, res) => {
  try {
    const sToken =
      req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.slice(7)
        : req.body?.sToken;

    if (!sToken) {
      return res.status(401).json({ error: 'Missing session token' });
    }

    const userData = await getUserDataFromToken(sToken);

    if (!userData?.id || !userData?.aToken) {
      return res.status(401).json({
        error: 'Discord reauthentication required'
      });
    }

    const response = await axios.put(
      'https://discord.com/api/v10/guilds/1387030831142277240/members/' +
        userData.id,
      { access_token: userData.aToken },
      {
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return res.status(200).json({
      success: true,
      status: response.status
    });
  } catch (error) {
    const discordStatus = error.response?.status;

    console.error(
      'Guild join failed:',
      error.response?.data || error.message
    );

    if (discordStatus === 401) {
      return res.status(401).json({
        error: 'Discord authorization expired; reauthentication may be required'
      });
    }

    return res.status(500).json({
      error: 'Failed to join Discord guild'
    });
  }
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
