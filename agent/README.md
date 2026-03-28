# 🧹 Spick Agent v1.2.1

Production-ready local automation agent for [spick.se](https://spick.se).  
Trigger browser automation from your phone → your computer opens Microsoft Edge → task executes.

```
Mobile/API → Express Server → Playwright → Microsoft Edge → spick.se
                ↕ WebSocket      ↕ Push (ntfy.sh)
            Dashboard (PWA)    Phone notification
```

## Quick Start

```bash
cd spick-agent
npm run setup          # install + wizard
npm start              # start agent
# Open http://localhost:3500/dashboard
```

Or on Windows: double-click `install.bat` → `start.bat`.

## System Overview

| Component | Count |
|-----------|-------|
| API endpoints | 19 |
| Automation tasks | 17 |
| Workflows | 4 |
| Source files | 44 |
| Lines of code | 4,400+ |

## API Endpoints

Visit `http://localhost:3500/api-docs` for full interactive documentation.

**Public:**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check, version, uptime |
| GET | `/dashboard` | Mobile PWA dashboard |
| GET | `/api-docs` | Full API documentation |

**Task execution (auth required):**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/tasks` | List all tasks with descriptions |
| POST | `/run-task` | Run task synchronously |
| POST | `/run-task-async` | Run task, return immediately |
| POST | `/run-queue` | Run multiple tasks in sequence |
| GET | `/task/:id` | Look up result by UUID |

**Workflows (auth required):**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/workflows` | List workflows |
| POST | `/run-workflow` | Run multi-step workflow |

**System (auth required):**
| Method | Path | Description |
|--------|------|-------------|
| GET | `/status` | Active tasks + history |
| GET | `/config` | Server config + memory |
| GET | `/logs/view` | Server logs (JSON) |
| GET | `/logs/screenshots` | Error screenshots list |
| POST | `/scheduler/toggle` | Start/stop scheduler |
| POST | `/stop` | Close browser |

**Webhooks:**
| Method | Path | Description |
|--------|------|-------------|
| POST | `/webhook/stripe` | Stripe payment events |
| POST | `/webhook/supabase` | Supabase DB changes |

**Real-time:**
| Protocol | Path | Description |
|----------|------|-------------|
| WebSocket | `/ws` | Live task events |

## Tasks (17)

| Task | Description |
|------|-------------|
| `test-flow` | Smoke test – opens Edge, loads spick.se |
| `self-test` | 9-point system diagnostic |
| `open-spick` | Navigate to spick.se, verify loaded |
| `start-booking-flow` | Full booking (real selectors, stops before pay) |
| `check-site-status` | Check all 6 key pages |
| `screenshot-page` | Full-page screenshot (desktop/mobile) |
| `admin-login` | Admin panel magic link |
| `monitor-stack` | Frontend + Supabase + Stripe health |
| `check-supabase` | Database stats, table counts |
| `check-bookings` | Recent bookings from Supabase |
| `watch-bookings` | Poll for new bookings, push notification |
| `seo-audit` | Meta tags, Schema.org, headings, alt text |
| `perf-audit` | Core Web Vitals, TTFB, FCP, resources |
| `test-cleaner-signup` | Validate bli-stadare.html form |
| `test-stripe-checkout` | Verify Stripe integration |
| `test-booking-e2e` | End-to-end booking QA |
| `run-all-checks` | Meta-task: site + stack + SEO |

## Workflows (4)

| Workflow | Steps | Use case |
|----------|-------|----------|
| `quick-health` | 2 | Daily check (~30s) |
| `morning-check` | 4 | Self-test → site → stack → bookings |
| `full-qa` | 7 | Complete QA suite |
| `deploy-verify` | 5 | Post-deploy validation (stops on error) |

```bash
curl -X POST http://localhost:3500/run-workflow \
  -H "Authorization: Bearer YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"workflow": "morning-check"}'
```

## Dashboard (PWA)

Mobile-first control panel at `/dashboard`. Features:
- **Install as app**: Add to home screen on iOS/Android
- **Workflow buttons**: One-tap morning check, QA, deploy verify
- **Task cards**: All 17 tasks with param dialogs
- **History panel**: Last 8 runs with clickable details
- **Live log**: WebSocket real-time events
- **Controls**: Scheduler toggle, config view, server logs, screenshots
- **Offline support**: Service worker caches dashboard

## Push Notifications (ntfy.sh)

```env
NTFY_TOPIC=spick-agent-farhad
```

1. Install **ntfy** app on phone
2. Subscribe to your topic
3. Get notifications on: task completion, new bookings, payment events, failures

## Webhooks

### Stripe
Set webhook URL in Stripe Dashboard → `https://your-agent/webhook/stripe`
Events: `checkout.session.completed`, `payment_intent.succeeded/failed`

### Supabase
Configure database webhook → `https://your-agent/webhook/supabase`
Triggers on new bookings in `bookings` table.

## Scheduler

```env
SCHEDULER_ENABLED=true
```

Default jobs:
- `check-site-status` every 60 min
- `monitor-stack` every 30 min
- `watch-bookings` every 15 min

Toggle from dashboard or API: `POST /scheduler/toggle`

## Remote Access

```bash
npm run tunnel              # Cloudflare quick tunnel
npm run tunnel:named        # Permanent URL
```

## Run as Service

```bash
# PM2
pm2 start ecosystem.config.js && pm2 save && pm2 startup

# Windows Task Scheduler
install-service.bat         # double-click as admin
```

## Create New Tasks

```bash
cp tasks/_template.js tasks/my-task.js
# Edit, restart agent
```

## Project Structure

```
spick-agent/
├── server.js              # Express API (19 endpoints, 532 lines)
├── browser.js             # Playwright Edge manager + auto-recovery
├── task-runner.js         # Task orchestration, locking, WebSocket events
├── workflows.js           # Multi-step workflow engine (4 workflows)
├── scheduler.js           # Recurring task scheduler (3 jobs)
├── live-feed.js           # WebSocket real-time broadcast
├── notify.js              # Push notifications via ntfy.sh
├── logger.js              # Winston structured logging
├── dashboard.html         # Mobile PWA dashboard (596 lines)
├── ecosystem.config.js    # PM2 config
├── package.json           # v1.2.1
├── middleware/
│   └── auth.js            # Bearer token + constant-time compare
├── public/
│   ├── manifest.json      # PWA manifest
│   ├── sw.js              # Service worker (offline support)
│   └── icon-*.svg         # App icons
├── tasks/                 # 17 automation tasks
├── scripts/
│   ├── setup-wizard.js    # Interactive first-run config
│   ├── setup-tunnel.js    # Cloudflare Tunnel
│   ├── generate-shortcuts.js  # iOS/Android shortcut generator
│   └── test-trigger.js    # CLI test tool
├── install.bat            # Windows installer
├── install-service.bat    # Windows service installer
└── start.bat              # Windows launcher
```

## Security

- Bearer token auth (constant-time comparison)
- Rate limiting: 30 req/min per IP
- Helmet.js security headers
- Single-task locking (no concurrent abuse)
- Webhook signature verification (Stripe)
- CSP headers for dashboard
- No credentials in code
