require(`dotenv`).config();
const express = require(`express`);
const authRoutes = require(`./routes/auth`);
const guildRoutes = require(`./routes/guild`);
const { port } = require(`./config`);

const app = express();

app.use(`/auth`, authRoutes);
app.use(guildRoutes);

app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
