require(`dotenv`).config();
const express = require(`express`);
const { URLSearchParams } = require(`url`);
const { randomBytes } = require(`crypto`);
const axios = require(`axios`);

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

    // Do not log or return the access token.
    return res.json({
      message: `Discord authorization successful`,
      user: userResponse.data,
    });
  } catch (error) {
    console.error(`Discord user lookup failed:`, error.message);
    return res.status(502).send(`Discord user lookup failed`);
  }
});

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
