require(`dotenv`).config();
const express = require(`express`);
const url = require(`url`);
const axios = require(`axios`);
const { userInfo } = require("os");

const port = process.env.PORT || 8000;
const app = express();

// redirectshit
app.get(`/auth/discord/redirect`, async (res, req) => {
  const { code } = req.query;

  if (code) {
    const formData = new url.URLSearchParams({
      client_id: process.env.CLIENTID,
      client_secret: process.evn.CLIENTSECRET,
      grant_type: `authorization_code`,
      code: code.toString(),
      redirect_uri: `http://localhost:8000/auth/discord/redirect`,
    })
    const output = await axios.post(`https://discord.com/api/v10/oauth2/token`,
      formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    if (output.data) {
      const access = output.data.access_token;
      const userInfo = await axios.get(`https://discord.com/api/v10/users/@me`, {
        headers: {
          'Authorization': `Bearer ${access}`,
        },
        console.log(output.data, userInfo.data)
      });
    }
  }
});

app.listen(port);
