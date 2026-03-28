// ecosystem.config.js – PM2 process manager configuration
//
// Install PM2:   npm install -g pm2
// Start:         pm2 start ecosystem.config.js
// Auto-restart:  pm2 save && pm2 startup
// Logs:          pm2 logs spick-agent
// Monitor:       pm2 monit

module.exports = {
  apps: [
    {
      name: "spick-agent",
      script: "server.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "500M",
      env: {
        NODE_ENV: "production",
        PORT: 3500,
      },
      max_restarts: 10,
      min_uptime: "10s",
      restart_delay: 2000,
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      merge_logs: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
    },
  ],
};
