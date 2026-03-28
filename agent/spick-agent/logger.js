// logger.js – Structured logging with Winston
const { createLogger, format, transports } = require("winston");
const path = require("path");

const LOG_DIR = path.join(__dirname, "logs");

const logger = createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.errors({ stack: true }),
    format.json()
  ),
  defaultMeta: { service: "spick-agent" },
  transports: [
    // Console – human-readable
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.printf(({ timestamp, level, message, taskId, step, ...rest }) => {
          const tid = taskId ? ` [${taskId.slice(0, 8)}]` : "";
          const s = step ? ` (${step})` : "";
          const extra = Object.keys(rest).length > 1 ? ` ${JSON.stringify(rest)}` : "";
          return `${timestamp} ${level}${tid}${s}: ${message}${extra}`;
        })
      ),
    }),
    // File – full JSON for auditing
    new transports.File({
      filename: path.join(LOG_DIR, "agent.log"),
      maxsize: 5 * 1024 * 1024, // 5 MB
      maxFiles: 5,
      tailable: true,
    }),
    // Errors only
    new transports.File({
      filename: path.join(LOG_DIR, "errors.log"),
      level: "error",
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
    }),
  ],
});

module.exports = logger;
