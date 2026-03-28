// task-runner.js – Orchestrates task execution with safety
const { v4: uuidv4 } = require("uuid");
const logger = require("./logger");
const browser = require("./browser");

// Lazy-load live-feed to avoid circular deps
let _liveFeed = null;
function liveFeed() {
  if (!_liveFeed) { try { _liveFeed = require("./live-feed"); } catch { _liveFeed = { taskStarted(){}, taskCompleted(){}, taskFailed(){} }; } }
  return _liveFeed;
}

class TaskRunner {
  constructor() {
    this.activeTasks = new Map();
    this.taskLock = false;
    this.history = [];
  }

  async run(taskName, params = {}) {
    if (this.taskLock) {
      const active = [...this.activeTasks.values()][0];
      logger.warn("Task rejected: another task is running", { requested: taskName, active: active?.name });
      return { taskId: null, status: "rejected", error: `Another task is already running: ${active?.name}` };
    }

    let taskModule;
    try {
      taskModule = require(`./tasks/${taskName}`);
    } catch (err) {
      logger.error("Task not found", { taskName, error: err.message });
      return { taskId: null, status: "error", error: `Unknown task: ${taskName}` };
    }

    const taskId = uuidv4();
    const startedAt = new Date().toISOString();

    this.taskLock = true;
    this.activeTasks.set(taskId, { name: taskName, status: "running", startedAt });

    logger.info("Task started", { taskId, taskName, params });
    liveFeed().taskStarted(taskId, taskName);

    let page = null;
    try {
      page = await browser.newPage();

      const result = await taskModule.execute(page, {
        ...params,
        taskId,
        logger: logger.child({ taskId, task: taskName }),
      });

      this.complete(taskId, taskName, "completed", result, startedAt);
      logger.info("Task completed", { taskId, taskName });
      liveFeed().taskCompleted(taskId, taskName, result);
      return { taskId, status: "completed", result };
    } catch (err) {
      logger.error("Task failed", { taskId, taskName, error: err.message, stack: err.stack });

      if (page) {
        try { await browser.screenshot(page, `${taskName}_fail`); } catch (_) {}
      }

      this.complete(taskId, taskName, "failed", null, startedAt, err.message);
      liveFeed().taskFailed(taskId, taskName, err.message);
      return { taskId, status: "failed", error: err.message };
    } finally {
      if (page) { try { await page.close(); } catch (_) {} }
      this.taskLock = false;
    }
  }

  complete(taskId, taskName, status, result, startedAt, error = null) {
    this.activeTasks.delete(taskId);
    this.history.unshift({
      taskId,
      taskName,
      status,
      result,
      error,
      startedAt,
      completedAt: new Date().toISOString(),
    });
    // Keep history bounded
    if (this.history.length > 50) this.history.pop();
  }

  getStatus() {
    return {
      busy: this.taskLock,
      activeTasks: Object.fromEntries(this.activeTasks),
      recentHistory: this.history.slice(0, 10),
    };
  }

  /**
   * List all available task names by scanning /tasks directory.
   */
  listTasks() {
    const fs = require("fs");
    const path = require("path");
    const tasksDir = path.join(__dirname, "tasks");
    try {
      return fs
        .readdirSync(tasksDir)
        .filter((f) => f.endsWith(".js"))
        .map((f) => f.replace(".js", ""));
    } catch {
      return [];
    }
  }
}

module.exports = new TaskRunner();
