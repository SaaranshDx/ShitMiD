const express = require(`express`);
const { URLSearchParams } = require(`url`);
const { randomBytes } = require(`crypto`);
const axios = require(`axios`);
const {
  clientId,
  clientSecret,
  redirectUri,
  scope,
  stateLifetime,
} = require(`../config`);
const {
  createSessionToken,
  getBearerToken,
  getUserDataFromToken,
  missingConfiguration,
  saveUserData,
} = require(`../utils/auth`);

const router = express.Router();
const pendingStates = new Map();

// Start OAuth from this route so the redirect URI and state are always consistent.
router.get(`/discord`, (req, res) => {
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

router.get(`/discord/redirect`, async (req, res) => {
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

router.get(`/verify`, async (req, res) => {
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

module.exports = router;
