// tasks/run-all-checks.js – Run all monitoring tasks in sequence
//
// Executes check-site-status, monitor-stack, and seo-audit as a single
// comprehensive health report. Useful for daily/weekly full checks.

module.exports = {
  name: "run-all-checks",
  description: "Comprehensive health check – runs site status + stack + SEO in one go",

  async execute(page, { logger }) {
    const report = { checks: [], overallOk: true };

    // ─── 1. Site Status ───
    logger.info("Running site status check...");
    try {
      const siteStatus = require("./check-site-status");
      const result = await siteStatus.execute(page, { logger });
      report.checks.push({
        name: "site-status",
        ok: result.allOk,
        summary: `${result.pages.filter((p) => p.ok).length}/${result.pages.length} pages OK`,
        failed: result.pages.filter((p) => !p.ok).map((p) => p.name),
      });
      if (!result.allOk) report.overallOk = false;
    } catch (err) {
      report.checks.push({ name: "site-status", ok: false, error: err.message });
      report.overallOk = false;
    }

    // ─── 2. Stack Monitor ───
    logger.info("Running stack monitor...");
    try {
      const monitor = require("./monitor-stack");
      const result = await monitor.execute(page, { logger });
      report.checks.push({
        name: "stack-monitor",
        ok: result.allOk,
        summary: `${result.totalChecks - result.failedChecks}/${result.totalChecks} checks OK`,
        failed: result.checks.filter((c) => !c.ok).map((c) => c.name),
      });
      if (!result.allOk) report.overallOk = false;
    } catch (err) {
      report.checks.push({ name: "stack-monitor", ok: false, error: err.message });
      report.overallOk = false;
    }

    // ─── 3. SEO Audit ───
    logger.info("Running SEO audit...");
    try {
      const seo = require("./seo-audit");
      const result = await seo.execute(page, { logger });
      report.checks.push({
        name: "seo-audit",
        ok: result.averageScore >= 70,
        summary: `Score: ${result.averageScore}/100, ${result.totalIssues} issues`,
        topIssues: result.pages
          .flatMap((p) => p.issues.map((i) => `${p.url.split("/").pop()}: ${i}`))
          .slice(0, 5),
      });
      if (result.averageScore < 70) report.overallOk = false;
    } catch (err) {
      report.checks.push({ name: "seo-audit", ok: false, error: err.message });
      report.overallOk = false;
    }

    // ─── Summary ───
    const passed = report.checks.filter((c) => c.ok).length;
    const total = report.checks.length;

    logger.info("All checks complete", {
      overall: report.overallOk ? "PASS" : "FAIL",
      passed: `${passed}/${total}`,
    });

    return {
      status: report.overallOk ? "all_pass" : "has_failures",
      passed,
      total,
      checks: report.checks,
      timestamp: new Date().toISOString(),
    };
  },
};
