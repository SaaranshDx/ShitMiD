const express = require(`express`);
const axios = require(`axios`);
const { getUserDataFromToken } = require(`../utils/auth`);

const router = express.Router();

// shitmid guild join endpoint
router.post(`/api/joinguild`, async (req, res) => {
  try {
    const sToken =
      req.headers.authorization?.startsWith(`Bearer `)
        ? req.headers.authorization.slice(7)
        : req.body?.sToken;

    if (!sToken) {
      return res.status(401).json({ error: `Missing session token` });
    }

    const userData = await getUserDataFromToken(sToken);

    if (!userData?.id || !userData?.aToken) {
      return res.status(401).json({
        error: `Discord reauthentication required`,
      });
    }

    const response = await axios.put(
      `https://discord.com/api/v10/guilds/1387030831142277240/members/` +
        userData.id,
      { access_token: userData.aToken },
      {
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          'Content-Type': `application/json`,
        },
      },
    );

    return res.status(200).json({
      success: true,
      status: response.status,
    });
  } catch (error) {
    const discordStatus = error.response?.status;

    console.error(
      `Guild join failed:`,
      error.response?.data || error.message,
    );

    if (discordStatus === 401) {
      return res.status(401).json({
        error: `Discord authorization expired; reauthentication may be required`,
      });
    }

    return res.status(500).json({
      error: `Failed to join Discord guild`,
    });
  }
});

module.exports = router;
