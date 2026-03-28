// notify.js – Push notifications via ntfy.sh (free, no signup needed)
//
// Setup:
//   1. Install ntfy app on your phone (iOS / Android)
//   2. Subscribe to a unique topic (e.g. "spick-agent-farhad")
//   3. Set NTFY_TOPIC=spick-agent-farhad in .env

const logger = require("./logger");

const NTFY_BASE = "https://ntfy.sh";

/**
 * Send a push notification.
 * @param {string} title
 * @param {string} message
 * @param {Object} options - { priority, tags, click }
 */
async function notify(title, message, options = {}) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) {
    logger.debug("NTFY_TOPIC not set – skipping notification");
    return;
  }

  const { priority = 3, tags = "robot", click = "" } = options;

  try {
    const response = await fetch(`${NTFY_BASE}/${topic}`, {
      method: "POST",
      headers: {
        Title: title,
        Priority: String(priority),
        Tags: tags,
        ...(click ? { Click: click } : {}),
      },
      body: message,
    });

    if (!response.ok) {
      logger.warn("Notification failed", { status: response.status });
    } else {
      logger.info("Notification sent", { title });
    }
  } catch (err) {
    logger.warn("Notification error", { error: err.message });
  }
}

/**
 * Notify on task completion or failure.
 */
async function notifyTaskResult(taskName, result) {
  const isOk = result.status === "completed";
  const title = `${isOk ? "✅" : "❌"} ${taskName}`;
  const body = isOk
    ? "Task completed successfully"
    : `Task failed: ${result.error || "unknown error"}`;

  await notify(title, body, {
    priority: isOk ? 3 : 4,
    tags: isOk ? "white_check_mark" : "x",
  });
}

module.exports = { notify, notifyTaskResult };
