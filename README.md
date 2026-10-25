# ShitMiD

Discord OAuth callback for the project.

## Setup

1. Copy `.env.example` to `.env` and fill in the Discord application values.
2. Add the exact value of `DISCORD_REDIRECT_URI` to the Discord Developer Portal under **OAuth2 → Redirects**.
3. Start the server:

   ```sh
   npm start
   ```

4. Open `http://localhost:8000/auth/discord` to start the OAuth flow.

The redirect URI must be identical in all three places: the authorization URL, the Discord Developer Portal, and the token exchange. If `PORT` changes, update `DISCORD_REDIRECT_URI` and the registered Discord redirect as well.

Authorization codes are single-use and expire quickly. If Discord returns `invalid_grant`, start the flow again instead of refreshing or revisiting the callback URL.

## Login token

The Discord redirect response creates a session token valid for seven days:

```json
{
  "message": "Discord authorization successful",
  "token": "<session-token>",
  "user": {}
}
```

Send that token to verify the logged-in user:

```sh
curl http://localhost:8000/auth/verify \\
  -H "Authorization: Bearer <session-token>"
```

A valid token returns `authenticated: true` and the saved user profile. Invalid or expired tokens return `401`. The token is stored as a hash in `db/usr`, and the raw token is not saved.

## WebSocket sessions

Connect to the WebSocket endpoint with the session token:

```js
const socket = new WebSocket(
  `ws://localhost:8000/ws?token=${encodeURIComponent(sessionToken)}`,
);
```

A successful connection sends a `session_started` message containing the random 12-character `sessionId`. Each connection is recorded in:

```text
db/usr/<user-id>/<session-id>.json
```

The session file is created when the WebSocket connects and updated when it closes with `connectedAt`, `disconnectedAt`, `durationMs`, `closeCode`, and `closeReason` fields. Session files are ignored by Git through the existing `db/` rule.
