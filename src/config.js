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

module.exports = {
  clientId,
  clientSecret,
  port,
  redirectUri,
  scope,
  sessionLifetime,
  stateLifetime,
};
