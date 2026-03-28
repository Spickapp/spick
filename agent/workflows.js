// workflows.js – Define and run multi-step task workflows
//
// A workflow is a sequence of tasks with optional conditions.
// If a task fails and stopOnError is true, the workflow stops.
//
// Usage via API:
//   POST /run-workflow { "workflow": "morning-check" }
//   GET /workflows

const logger = require("./logger");
const taskRunner = require("./task-runner");
const { notify } = require("./notify");

// ── Define workflows ──
const WORKFLOWS = {
  "morning-check": {
    name: "Morgonkoll",
    description: "Kör alla viktiga checks: site status, stack, bookings",
    stopOnError: false,
    steps: [
      { task: "self-test", label: "Systemdiagnostik" },
      { task: "check-site-status", label: "Sidkontroll" },
      { task: "monitor-stack", label: "Stack-monitor" },
      { task: "watch-bookings", label: "Nya bokningar" },
    ],
  },

  "full-qa": {
    name: "Full QA-svit",
    description: "Komplett kvalitetskontroll av hela plattformen",
    stopOnError: false,
    steps: [
      { task: "self-test", label: "Systemdiagnostik" },
      { task: "check-site-status", label: "Sidkontroll" },
      { task: "seo-audit", label: "SEO-analys" },
      { task: "perf-audit", label: "Prestanda" },
      { task: "test-cleaner-signup", label: "Registreringsformulär" },
      { task: "test-stripe-checkout", label: "Stripe-integration" },
      { task: "start-booking-flow", label: "Bokningsflöde" },
    ],
  },

  "deploy-verify": {
    name: "Deploy-verifiering",
    description: "Kör efter deploy – verifierar att allt fungerar",
    stopOnError: true,
    steps: [
      { task: "self-test", label: "Systemdiagnostik" },
      { task: "check-site-status", label: "Alla sidor laddar" },
      { task: "monitor-stack", label: "Supabase + Stripe" },
      { task: "test-stripe-checkout", label: "Betalning fungerar" },
      { task: "screenshot-page", label: "Screenshot", params: { url: "https://spick.se", device: "mobile" } },
    ],
  },

  "quick-health": {
    name: "Snabbkoll",
    description: "Snabb hälsokontroll – tar ~30 sekunder",
    stopOnError: false,
    steps: [
      { task: "check-site-status", label: "Sidkontroll" },
      { task: "watch-bookings", label: "Nya bokningar" },
    ],
  },
};

class WorkflowEngine {
  /**
   * Run a named workflow.
   * Returns { workflow, status, steps[], totalMs }
   */
  async run(workflowId) {
    const wf = WORKFLOWS[workflowId];
    if (!wf) {
      return { status: "error", error: `Unknown workflow: ${workflowId}`, available: Object.keys(WORKFLOWS) };
    }

    logger.info(`Workflow started: ${wf.name}`, { id: workflowId, steps: wf.steps.length });
    const startTime = Date.now();
    const results = [];
    let stopped = false;

    for (let i = 0; i < wf.steps.length; i++) {
      const step = wf.steps[i];

      if (stopped) {
        results.push({ step: i + 1, task: step.task, label: step.label, status: "skipped" });
        continue;
      }

      logger.info(`Workflow step ${i + 1}/${wf.steps.length}: ${step.label}`);

      try {
        const result = await taskRunner.run(step.task, step.params || {});
        results.push({
          step: i + 1,
          task: step.task,
          label: step.label,
          status: result.status,
          result: result.status === "completed" ? result.result : undefined,
          error: result.error,
        });

        if (result.status !== "completed" && wf.stopOnError) {
          logger.warn(`Workflow stopped at step ${i + 1}: ${step.task} failed`);
          stopped = true;
        }
      } catch (err) {
        results.push({
          step: i + 1,
          task: step.task,
          label: step.label,
          status: "error",
          error: err.message,
        });
        if (wf.stopOnError) stopped = true;
      }
    }

    const totalMs = Date.now() - startTime;
    const passed = results.filter((r) => r.status === "completed").length;
    const failed = results.filter((r) => r.status === "failed" || r.status === "error").length;
    const skipped = results.filter((r) => r.status === "skipped").length;

    const allOk = failed === 0;

    // Send notification
    try {
      await notify(
        `${allOk ? "✅" : "⚠️"} ${wf.name}`,
        `${passed}/${results.length} OK${failed > 0 ? ", " + failed + " failed" : ""}${skipped > 0 ? ", " + skipped + " skipped" : ""} (${Math.round(totalMs / 1000)}s)`,
        { priority: allOk ? 3 : 4, tags: allOk ? "white_check_mark" : "warning" }
      );
    } catch {}

    logger.info(`Workflow complete: ${wf.name}`, { passed, failed, skipped, totalMs });

    return {
      workflow: workflowId,
      name: wf.name,
      status: allOk ? "all_pass" : stopped ? "stopped" : "has_failures",
      passed,
      failed,
      skipped,
      total: results.length,
      totalMs,
      steps: results,
      timestamp: new Date().toISOString(),
    };
  }

  list() {
    return Object.entries(WORKFLOWS).map(([id, wf]) => ({
      id,
      name: wf.name,
      description: wf.description,
      steps: wf.steps.length,
      stopOnError: wf.stopOnError,
    }));
  }
}

module.exports = new WorkflowEngine();
