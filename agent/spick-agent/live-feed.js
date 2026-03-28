// live-feed.js – WebSocket server for real-time dashboard updates
//
// Broadcasts events to all connected dashboard clients:
//   - task:started
//   - task:step      (mid-task progress)
//   - task:completed
//   - task:failed
//   - agent:status

const { WebSocketServer } = require("ws");
const logger = require("./logger");

class LiveFeed {
  constructor() {
    this.wss = null;
    this.clients = new Set();
  }

  /**
   * Attach WebSocket server to existing HTTP server.
   */
  attach(httpServer) {
    this.wss = new WebSocketServer({ server: httpServer, path: "/ws" });

    this.wss.on("connection", (ws, req) => {
      const ip = req.socket.remoteAddress;
      logger.info("WebSocket client connected", { ip });
      this.clients.add(ws);

      // Send welcome
      ws.send(JSON.stringify({
        type: "connected",
        timestamp: new Date().toISOString(),
        message: "Live feed active",
      }));

      ws.on("close", () => {
        this.clients.delete(ws);
        logger.debug("WebSocket client disconnected", { ip });
      });

      ws.on("error", () => {
        this.clients.delete(ws);
      });
    });

    logger.info("WebSocket live feed ready on /ws");
  }

  /**
   * Broadcast an event to all connected clients.
   */
  broadcast(type, data) {
    if (!this.wss) return;

    const message = JSON.stringify({
      type,
      timestamp: new Date().toISOString(),
      ...data,
    });

    for (const client of this.clients) {
      try {
        if (client.readyState === 1) { // OPEN
          client.send(message);
        }
      } catch {
        this.clients.delete(client);
      }
    }
  }

  taskStarted(taskId, taskName) {
    this.broadcast("task:started", { taskId, taskName });
  }

  taskStep(taskId, taskName, step, detail) {
    this.broadcast("task:step", { taskId, taskName, step, detail });
  }

  taskCompleted(taskId, taskName, result) {
    this.broadcast("task:completed", { taskId, taskName, result });
  }

  taskFailed(taskId, taskName, error) {
    this.broadcast("task:failed", { taskId, taskName, error });
  }

  get connectedClients() {
    return this.clients.size;
  }
}

// Singleton
module.exports = new LiveFeed();
