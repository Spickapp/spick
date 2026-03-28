// tasks/_template.js – Copy this file to create new tasks
//
// 1. Copy: cp tasks/_template.js tasks/my-new-task.js
// 2. Edit the name, description, and execute() function
// 3. Restart the agent (or it will auto-detect on next /tasks call)
// 4. Trigger via: POST /run-task { "task": "my-new-task" }

module.exports = {
  name: "my-new-task",
  description: "Describe what this task does",

  /**
   * @param {import('playwright').Page} page – Playwright page object
   * @param {Object} ctx – Context object
   * @param {import('winston').Logger} ctx.logger – Scoped logger
   * @param {string} ctx.taskId – Unique ID for this execution
   * @param {Object} ctx.params – Parameters from the API request
   */
  async execute(page, { logger, taskId, params }) {
    // Step 1: Navigate
    logger.info("Step 1: Navigating...");
    await page.goto("https://spick.se", { waitUntil: "domcontentloaded" });

    // Step 2: Interact
    logger.info("Step 2: Interacting...");
    // await page.click('button:has-text("Click me")');
    // await page.fill('#input-field', 'value');

    // Step 3: Extract data
    logger.info("Step 3: Extracting...");
    const title = await page.title();

    // Return results
    return {
      title,
      timestamp: new Date().toISOString(),
    };
  },
};
