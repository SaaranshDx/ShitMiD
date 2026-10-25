const { URL } = require(`url`);
const { WebSocketServer } = require(`ws`);
const { getUserDataFromToken } = require(`../utils/auth`);
const {
  closeWebSocketSession,
  createWebSocketSession,
} = require(`../utils/websocketSession`);

function getWebSocketToken(request) {
  const authorization = request.headers.authorization;

  if (authorization?.startsWith(`Bearer `)) {
    return authorization.slice(`Bearer `.length).trim();
  }

  const requestUrl = new URL(
    request.url,
    `http://${request.headers.host || `localhost`}`,
  );
  return requestUrl.searchParams.get(`token`) || requestUrl.searchParams.get(`sToken`);
}

function attachWebSocketServer(server) {
  const websocketServer = new WebSocketServer({
    path: `/ws`,
    server,
  });

  websocketServer.on(`connection`, async (socket, request) => {
    const userData = await getUserDataFromToken(getWebSocketToken(request));

    if (!userData) {
      socket.close(1008, `Invalid or expired session token`);
      return;
    }

    let session;
    try {
      session = await createWebSocketSession(userData.id, userData.username);
    } catch (error) {
      console.error(`Failed to create WebSocket session:`, error.message);
      socket.close(1011, `Failed to create session`);
      return;
    }

    socket.send(
      JSON.stringify({
        type: `session_started`,
        sessionId: session.data.sessionId,
        connectedAt: session.data.connectedAt,
      }),
    );

    socket.on(`close`, async (closeCode, reason) => {
      try {
        await closeWebSocketSession(
          session,
          closeCode,
          reason.toString(`utf8`),
        );
      } catch (error) {
        console.error(`Failed to close WebSocket session:`, error.message);
      }
    });
  });

  return websocketServer;
}

module.exports = {
  attachWebSocketServer,
};
