require(`dotenv`).config();
const express = require(`express`);
const authRoutes = require(`./routes/auth`);
const guildRoutes = require(`./routes/guild`);
const { attachWebSocketServer } = require(`./routes/websocket`);
const { port } = require(`./config`);

const app = express();

app.use(`/auth`, authRoutes);
app.use(guildRoutes);

const server = app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});

attachWebSocketServer(server);
