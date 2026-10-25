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


## Metered session WebSocket (STP v1)

The session telemetry WebSocket shares the existing HTTP server and port at `/session`.

Install dependencies with `npm install`, then start the service with `npm start`.

Connect to `ws://localhost:8000/session` in local development (use `wss://` behind TLS in production). Within 10 seconds, send a JSON text frame:

```json
{
  "v": 1,
  "type": "authenticate",
  "data": {
    "token": "<existing-session-token>"
  }
}
```

A successful authentication returns an `authenticated` message with a server-generated `session_id` and `started_at`. The token is verified using the existing session store and is never written to telemetry records.

After authentication, supported messages are `ping` (application heartbeat) and `close` (request a normal disconnect). STP v1 accepts JSON text frames only. WebSocket control-frame ping/pong is also used to detect dead connections.

Completed authenticated sessions are appended as JSON Lines to `db/telemetry/sessions.jsonl`. Records include the internal user ID, session ID, server start/end timestamps, monotonic duration, application-payload byte counts, and close code/reason. Byte counts exclude WebSocket framing, TCP, and TLS overhead. Unauthenticated connections are not recorded as metered sessions.

This initial implementation stores completed records locally and keeps active connection state in memory. For multi-instance deployments or durable active-session recovery, use a shared database and distributed connection tracking.
