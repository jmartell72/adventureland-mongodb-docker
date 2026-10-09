// Dev only: log in as a character in headless Chromium, check the game
// loads, press the Inventory key, and save screenshots. Run after
// scripts/dev/up.sh:
//   node scripts/dev/smoke.js [character] [out_dir]
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const character = process.argv[2] || "Kingmartell";
const out = process.argv[3] || path.join(os.homedir(), ".al-dev", "screenshots");
const cookie = fs.readFileSync(path.join(os.homedir(), ".al-dev", "cookie"), "utf8").trim().replace(/^auth=/, "");
// Cloud sessions ship Chromium at /opt/pw-browsers; elsewhere use Playwright's own.
const executablePath = fs.existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined;

(async () => {
	fs.mkdirSync(out, { recursive: true });
	const browser = await chromium.launch({ executablePath });
	const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
	await ctx.addCookies([{ name: "auth", value: cookie, domain: "127.0.0.1", path: "/" }]);
	const page = await ctx.newPage();
	const errors = [];
	page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
	page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));

	await page.goto("http://127.0.0.1:8090/character/" + character + "/in/US/I");
	const loaded = await page
		.waitForFunction(() => window.character && window.character.name, null, { timeout: 30000 })
		.then(() => true)
		.catch(() => false);
	await page.waitForTimeout(2000);
	await page.screenshot({ path: path.join(out, "01-ingame.png") });
	await page.keyboard.press("i");
	await page.waitForTimeout(1500);
	await page.screenshot({ path: path.join(out, "02-inventory.png") });

	console.log(JSON.stringify({ loaded, character: loaded ? await page.evaluate(() => character.name) : null, errors }, null, 2));
	console.log("screenshots in " + out);
	await browser.close();
	process.exit(loaded && !errors.length ? 0 : 1);
})();
