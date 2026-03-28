// scheduler.js – Optional recurring task scheduler
//
// Enable by setting SCHEDULER_ENABLED=true in .env
// Configure jobs in the JOBS array below.

const logger = require("./logger");
const taskRunner = require("./task-runner");
const { notifyTaskResult } = require("./notify");

// ── Define scheduled jobs ──
const JOBS = [
  {
    name: "Site health check",
    task: "check-site-status",
    params: {},
    intervalMinutes: 60,
    enabled: true,
  },
  {
    name: "Stack monitor",
    task: "monitor-stack",
    params: {},
    intervalMinutes: 30,
    enabled: true,
  },
  {
    name: "Booking watcher",
    task: "watch-bookings",
    params: {},
    intervalMinutes: 15, // check every 15 min
    enabled: true,
  },
];

class Scheduler {
  constructor() {
    this.timers = [];
    this.running = false;
  }

  start() {
    if (process.env.SCHEDULER_ENABLED !== "true") {
      logger.info("Scheduler disabled (set SCHEDULER_ENABLED=true to enable)");
      return;
    }

    logger.info("Scheduler starting", {
      jobs: JOBS.filter((j) => j.enabled).length,
    });

    for (const job of JOBS) {
      if (!job.enabled) continue;

      const ms = job.intervalMinutes * 60 * 1000;

      logger.info(`Scheduling: ${job.name}`, {
        task: job.task,
        interval: `${job.intervalMinutes}m`,
      });

      // Run once after a short delay, then on interval
      const initial = setTimeout(() => this.executeJob(job), 30000);
      const recurring = setInterval(() => this.executeJob(job), ms);

      this.timers.push(initial, recurring);
    }

    this.running = true;
  }

  async executeJob(job) {
    logger.info(`Scheduled job running: ${job.name}`);

    try {
      const result = await taskRunner.run(job.task, job.params);

      // Only notify on failure for scheduled jobs (avoid spam)
      if (result.status === "failed") {
        await notifyTaskResult(`[Scheduled] ${job.task}`, result);
      }

      // For monitoring tasks, notify if checks fail
      if (result.result && result.result.allOk === false) {
        const { notify } = require("./notify");
        await notify(
          `⚠️ ${job.name}`,
          `${result.result.failedChecks} checks failed`,
          { priority: 4, tags: "warning" }
        );
      }
    } catch (err) {
      logger.error(`Scheduled job error: ${job.name}`, { error: err.message });
    }
  }

  stop() {
    for (const t of this.timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    this.timers = [];
    this.running = false;
    logger.info("Scheduler stopped");
  }
}

module.exports = new Scheduler();
