import { chromium } from "/Users/maksimtcvetkov/.npm/_npx/e41f203b7505f1fb/node_modules/playwright/index.mjs";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("console", m => { if (m.text().includes("DEBUG")) console.log("[console]", m.text()); });
await page.goto("http://localhost:8443/", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await browser.close();
