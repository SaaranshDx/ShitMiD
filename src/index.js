require(`dotenv`).config();
const express = require(`express`);
const http = require(`node:http`);
const { attachSessionWebSocket } = require(`./session`);
const authRoutes = require(`./routes/auth`);
const guildRoutes = require(`./routes/guild`);
const { port } = require(`./config`);

const app = express();

app.use(`/auth`, authRoutes);
app.use(guildRoutes);

const server = http.createServer(app);
attachSessionWebSocket(server);

server.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
  console.log(`STP v1 WebSocket listening on ws://localhost:${port}/session`);
});
