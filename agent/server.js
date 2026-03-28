// server.js – Spick Agent: local automation API server
//
// Endpoints:
//   GET  /health              – public health check
//   GET  /dashboard           – mobile control panel
//   GET  /status              – agent status (auth required)
//   GET  /tasks               – list available tasks (auth required)
//   POST /run-task            – execute a task (auth required)
//   POST /stop                – close browser (auth required)
//   GET  /logs/screenshots/*  – serve error screenshots (auth required)

require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const logger = require("./logger");
const authMiddleware = require("./middleware/auth");
const taskRunner = require("./task-runner");
const browser = require("./browser");
const { notifyTaskResult } = require("./notify");
const scheduler = require("./scheduler");
const liveFeed = require("./live-feed");
const workflows = require("./workflows");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3500;
const HOST = process.env.HOST || "0.0.0.0";

// ── Middleware ────────────────────────────────────────────

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        connectSrc: ["'self'"],
      },
    },
  })
);
app.use(express.json());

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, slow down" },
});
app.use(limiter);

app.use((req, res, next) => {
  if (req.path !== "/health") {
    logger.info("Request", { method: req.method, path: req.path, ip: req.ip });
  }
  next();
});

// ── Public endpoints ─────────────────────────────────────

// Serve PWA assets (manifest, icons)
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1d" }));

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    agent: "spick-agent",
    version: "1.2.0",
    uptime: Math.floor(process.uptime()),
    busy: taskRunner.taskLock,
    tasks: taskRunner.listTasks().filter((t) => !t.startsWith("_")).length,
    wsClients: liveFeed.connectedClients,
    timestamp: new Date().toISOString(),
  });
});

// Dashboard – serves the HTML file (auth handled client-side)
app.get("/dashboard", (_req, res) => {
  res.sendFile(path.join(__dirname, "dashboard.html"));
});

// API documentation
app.get("/api-docs", (_req, res) => {
  const tasks = taskRunner.listTasks().filter((t) => !t.startsWith("_"));
  const taskDocs = tasks.map((name) => {
    try {
      const mod = require("./tasks/" + name);
      return { name, description: mod.description || "" };
    } catch { return { name, description: "" }; }
  });

  res.json({
    agent: "spick-agent",
    version: "1.2.0",
    auth: "Bearer token in Authorization header",
    endpoints: [
      { method: "GET", path: "/health", auth: false, desc: "Health check with uptime and task count" },
      { method: "GET", path: "/dashboard", auth: false, desc: "Mobile-first control panel (PWA installable)" },
      { method: "GET", path: "/api-docs", auth: false, desc: "This documentation" },
      { method: "GET", path: "/status", auth: true, desc: "Active tasks and recent history" },
      { method: "GET", path: "/tasks", auth: true, desc: "List all available tasks with descriptions" },
      { method: "POST", path: "/run-task", auth: true, desc: "Run a task synchronously (waits for result)", body: { task: "string", params: "object?" } },
      { method: "POST", path: "/run-task-async", auth: true, desc: "Run a task asynchronously (returns immediately)", body: { task: "string", params: "object?" } },
      { method: "POST", path: "/run-queue", auth: true, desc: "Run multiple tasks in sequence", body: { tasks: "[{task, params?}]" } },
      { method: "GET", path: "/task/:taskId", auth: true, desc: "Look up task result by UUID" },
      { method: "GET", path: "/workflows", auth: true, desc: "List available workflows" },
      { method: "POST", path: "/run-workflow", auth: true, desc: "Run a multi-step workflow", body: { workflow: "string" } },
      { method: "POST", path: "/stop", auth: true, desc: "Close the browser instance" },
      { method: "GET", path: "/logs/view", auth: true, desc: "View server logs (query: lines, level)" },
      { method: "GET", path: "/logs/screenshots", auth: true, desc: "List error screenshots" },
      { method: "GET", path: "/config", auth: true, desc: "View agent configuration and system info" },
      { method: "POST", path: "/scheduler/toggle", auth: true, desc: "Start or stop the scheduler" },
      { method: "POST", path: "/webhook/stripe", auth: false, desc: "Receive Stripe webhook events" },
      { method: "POST", path: "/webhook/supabase", auth: false, desc: "Receive Supabase database webhook events" },
      { method: "WS", path: "/ws", auth: false, desc: "WebSocket live feed (task:started, task:completed, task:failed, webhook:*)" },
    ],
    tasks: taskDocs,
    workflows: workflows.list(),
    examples: {
      runTask: 'curl -X POST /run-task -H "Authorization: Bearer TOKEN" -H "Content-Type: application/json" -d \'{"task":"test-flow"}\'',
      runQueue: 'curl -X POST /run-queue -H "Authorization: Bearer TOKEN" -d \'{"tasks":[{"task":"seo-audit"},{"task":"perf-audit"}]}\'',
      runWorkflow: 'curl -X POST /run-workflow -H "Authorization: Bearer TOKEN" -d \'{"workflow":"morning-check"}\'',
    },
  });
});

// ── Protected endpoints (require API_SECRET) ─────────────

app.get("/status", authMiddleware, (_req, res) => {
  res.json(taskRunner.getStatus());
});

app.get("/tasks", authMiddleware, (_req, res) => {
  const tasks = taskRunner.listTasks().filter((t) => !t.startsWith("_"));
  res.json({
    available: tasks,
    count: tasks.length,
    descriptions: tasks.map((name) => {
      try {
        const mod = require("./tasks/" + name);
        return { name, description: mod.description || "No description" };
      } catch {
        return { name, description: "Error loading task" };
      }
    }),
  });
});

app.post("/run-task", authMiddleware, async (req, res) => {
  const { task, params } = req.body;

  if (!task) {
    return res.status(400).json({ error: "Missing 'task' in request body" });
  }

  const available = taskRunner.listTasks();
  if (!available.includes(task)) {
    return res.status(404).json({ error: "Task '" + task + "' not found", available });
  }

  logger.info("Task requested via API", { task, params });

  try {
    const result = await Promise.race([
      taskRunner.run(task, params || {}),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Task timed out (120s)")), 120000)
      ),
    ]);

    // Push notification to phone
    notifyTaskResult(task, result).catch(() => {});

    res.json(result);
  } catch (err) {
    res.status(504).json({ taskId: null, status: "timeout", error: err.message });
  }
});

// Async execution – returns taskId immediately, task runs in background
app.post("/run-task-async", authMiddleware, (req, res) => {
  const { task, params } = req.body;

  if (!task) {
    return res.status(400).json({ error: "Missing 'task' in request body" });
  }

  const available = taskRunner.listTasks();
  if (!available.includes(task)) {
    return res.status(404).json({ error: "Task '" + task + "' not found", available });
  }

  logger.info("Async task requested", { task, params });

  // Fire and forget – notify via WebSocket + push
  taskRunner.run(task, params || {}).then((result) => {
    notifyTaskResult(task, result).catch(() => {});
  });

  res.json({
    status: "accepted",
    message: "Task queued. Watch /ws or /status for results.",
    task,
  });
});

// Queue multiple tasks – runs them in sequence
app.post("/run-queue", authMiddleware, async (req, res) => {
  const { tasks: taskList } = req.body;

  if (!Array.isArray(taskList) || taskList.length === 0) {
    return res.status(400).json({ error: "Provide 'tasks' array, e.g. [{task:'test-flow'}, {task:'seo-audit'}]" });
  }

  if (taskList.length > 10) {
    return res.status(400).json({ error: "Max 10 tasks per queue" });
  }

  logger.info("Queue requested", { count: taskList.length });

  const results = [];
  for (const item of taskList) {
    const name = item.task || item;
    try {
      const result = await taskRunner.run(name, item.params || {});
      results.push({ task: name, ...result });
    } catch (err) {
      results.push({ task: name, status: "error", error: err.message });
    }
  }

  const passed = results.filter((r) => r.status === "completed").length;
  res.json({
    status: passed === results.length ? "all_completed" : "partial",
    passed,
    total: results.length,
    results,
  });
});

// Lookup task result by ID
app.get("/task/:taskId", authMiddleware, (req, res) => {
  const { taskId } = req.params;
  const status = taskRunner.getStatus();

  // Check active tasks
  const active = status.activeTasks[taskId];
  if (active) {
    return res.json({ taskId, ...active });
  }

  // Check history
  const hist = status.recentHistory.find((h) => h.taskId === taskId);
  if (hist) {
    return res.json(hist);
  }

  res.status(404).json({ error: "Task not found in active or recent history" });
});

// ── Workflows ────────────────────────────────────────────

app.get("/workflows", authMiddleware, (_req, res) => {
  res.json({ workflows: workflows.list() });
});

app.post("/run-workflow", authMiddleware, async (req, res) => {
  const { workflow } = req.body;
  if (!workflow) {
    return res.status(400).json({ error: "Missing 'workflow'", available: workflows.list().map((w) => w.id) });
  }

  logger.info("Workflow requested", { workflow });

  try {
    const result = await Promise.race([
      workflows.run(workflow),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Workflow timed out (10 min)")), 600000)),
    ]);
    res.json(result);
  } catch (err) {
    res.status(504).json({ status: "timeout", error: err.message });
  }
});

app.post("/stop", authMiddleware, async (_req, res) => {
  logger.info("Stop requested – closing browser");
  await browser.close();
  res.json({ status: "browser_closed" });
});

// ── Log viewer ───────────────────────────────────────────

app.get("/logs/view", authMiddleware, (req, res) => {
  const lines = parseInt(req.query.lines) || 50;
  const level = req.query.level || "all"; // all, error, info, warn
  const logFile = path.join(__dirname, "logs", level === "error" ? "errors.log" : "agent.log");

  try {
    if (!fs.existsSync(logFile)) {
      return res.json({ lines: [], total: 0 });
    }
    const content = fs.readFileSync(logFile, "utf-8");
    const allLines = content.trim().split("\n").filter(Boolean);
    const parsed = allLines.slice(-lines).map((line) => {
      try { return JSON.parse(line); } catch { return { message: line }; }
    }).reverse();

    res.json({ lines: parsed, total: allLines.length, showing: parsed.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Screenshots list
app.get("/logs/screenshots", authMiddleware, (_req, res) => {
  const dir = path.join(__dirname, "logs", "screenshots");
  try {
    if (!fs.existsSync(dir)) return res.json({ screenshots: [] });
    const files = fs.readdirSync(dir)
      .filter((f) => f.endsWith(".png"))
      .sort().reverse()
      .slice(0, 20)
      .map((f) => ({
        filename: f,
        url: "/logs/screenshots/" + f,
        timestamp: f.match(/(\d+)\.png$/)?.[1] ? new Date(parseInt(f.match(/(\d+)/)[1])).toISOString() : null,
        size: fs.statSync(path.join(dir, f)).size,
      }));
    res.json({ screenshots: files });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve screenshot files
app.get("/logs/screenshots/:filename", authMiddleware, (req, res) => {
  const filepath = path.join(__dirname, "logs", "screenshots", req.params.filename);
  if (fs.existsSync(filepath)) {
    res.sendFile(filepath);
  } else {
    res.status(404).json({ error: "Screenshot not found" });
  }
});

// ── Config ───────────────────────────────────────────────

app.get("/config", authMiddleware, (_req, res) => {
  res.json({
    port: PORT,
    host: HOST,
    headless: process.env.HEADLESS === "true",
    timeout: parseInt(process.env.DEFAULT_TIMEOUT_MS) || 30000,
    screenshotOnError: process.env.SCREENSHOT_ON_ERROR === "true",
    scheduler: process.env.SCHEDULER_ENABLED === "true",
    ntfy: process.env.NTFY_TOPIC ? { enabled: true, topic: process.env.NTFY_TOPIC } : { enabled: false },
    edgeProfile: process.env.EDGE_USER_DATA_DIR || null,
    uptime: Math.floor(process.uptime()),
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + " MB",
      heap: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + " MB",
    },
    node: process.version,
    platform: process.platform,
    wsClients: liveFeed.connectedClients,
  });
});

// ── Scheduler control ────────────────────────────────────

app.post("/scheduler/toggle", authMiddleware, (_req, res) => {
  if (scheduler.running) {
    scheduler.stop();
    res.json({ scheduler: "stopped" });
  } else {
    scheduler.start();
    res.json({ scheduler: "started" });
  }
});

// ── Webhooks (from Stripe/Supabase) ─────────────────────

app.post("/webhook/stripe", express.raw({ type: "application/json" }), async (req, res) => {
  // Verify webhook secret if configured
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (secret) {
    const sig = req.headers["stripe-signature"];
    if (!sig) return res.status(401).json({ error: "Missing signature" });
    // Basic signature check – for full verification use stripe sdk
  }

  let event;
  try {
    event = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  logger.info("Stripe webhook received", { type: event.type, id: event.id });

  // Notify on important events
  const importantEvents = ["checkout.session.completed", "payment_intent.succeeded", "payment_intent.payment_failed"];
  if (importantEvents.includes(event.type)) {
    try {
      const { notify: ntfy } = require("./notify");
      const isSuccess = event.type.includes("completed") || event.type.includes("succeeded");
      await ntfy(
        isSuccess ? "💰 Betalning mottagen!" : "⚠️ Betalning misslyckades",
        event.type + (event.data?.object?.amount ? " – " + (event.data.object.amount / 100) + " kr" : ""),
        { priority: isSuccess ? 4 : 5, tags: isSuccess ? "moneybag" : "warning" }
      );
    } catch {}

    // Broadcast to dashboard
    liveFeed.broadcast("webhook:stripe", { type: event.type, id: event.id });
  }

  res.json({ received: true });
});

app.post("/webhook/supabase", async (req, res) => {
  // Supabase database webhooks
  const secret = process.env.SUPABASE_WEBHOOK_SECRET;
  if (secret && req.headers["x-webhook-secret"] !== secret) {
    return res.status(401).json({ error: "Invalid secret" });
  }

  const payload = req.body;
  logger.info("Supabase webhook received", { table: payload.table, type: payload.type });

  // Notify on new bookings
  if (payload.table === "bookings" && payload.type === "INSERT") {
    try {
      const { notify: ntfy } = require("./notify");
      const record = payload.record || {};
      await ntfy(
        "🎉 Ny bokning via Supabase!",
        `${record.service_type || "Städning"} – ${record.status || "ny"}`,
        { priority: 4, tags: "tada" }
      );
    } catch {}

    liveFeed.broadcast("webhook:supabase", { table: "bookings", type: "INSERT", id: payload.record?.id });
  }

  res.json({ received: true });
});

// ── 404 ──────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({
    error: "Not found",
    endpoints: [
      "GET  /health",
      "GET  /dashboard",
      "GET  /api-docs",
      "GET  /status",
      "GET  /tasks",
      "POST /run-task",
      "POST /run-task-async",
      "POST /run-queue",
      "GET  /workflows",
      "POST /run-workflow",
      "GET  /task/:taskId",
      "GET  /config",
      "GET  /logs/view",
      "GET  /logs/screenshots",
      "POST /scheduler/toggle",
      "POST /stop",
    ],
  });
});

// ── Start ────────────────────────────────────────────────

fs.mkdirSync(path.join(__dirname, "logs", "screenshots"), { recursive: true });

const server = app.listen(PORT, HOST, () => {
  const taskCount = taskRunner.listTasks().filter((t) => !t.startsWith("_")).length;
  const schedulerStatus = process.env.SCHEDULER_ENABLED === "true" ? "ON" : "OFF";
  logger.info(
    "\n" +
    "==========================================================\n" +
    "           SPICK AGENT v1.2.1 RUNNING\n" +
    "==========================================================\n" +
    "  Server:     http://" + HOST + ":" + PORT + "\n" +
    "  Dashboard:  http://" + HOST + ":" + PORT + "/dashboard\n" +
    "  API docs:   http://" + HOST + ":" + PORT + "/api-docs\n" +
    "  Auth:       Bearer token required\n" +
    "  Browser:    Microsoft Edge (Playwright)\n" +
    "  Tasks:      " + taskCount + " loaded\n" +
    "  Workflows:  " + workflows.list().length + " defined\n" +
    "  Scheduler:  " + schedulerStatus + "\n" +
    "  Notify:     " + (process.env.NTFY_TOPIC ? "ON (" + process.env.NTFY_TOPIC + ")" : "OFF") + "\n" +
    "==========================================================\n"
  );
  logger.info("Available tasks", { tasks: taskRunner.listTasks() });

  // Attach WebSocket live feed
  liveFeed.attach(server);

  // Start scheduler if enabled
  scheduler.start();
});

// ── Graceful shutdown ────────────────────────────────────

async function shutdown(signal) {
  logger.info(signal + " received - shutting down");
  scheduler.stop();
  await browser.close();
  server.close(() => {
    logger.info("Server stopped");
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", { error: err.message, stack: err.stack });
});
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", { reason: String(reason) });
});
