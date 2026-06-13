const { chromium } = require("playwright");

const URL = process.argv[2] || "https://jobs.ashbyhq.com/salient/a213eea8-ef18-40cb-b693-67ca3900c7fb/application";

async function main() {
    const browser = await chromium.launch({ headless: false, channel: process.env.JOB_AUTO_APPLY_BROWSER_CHANNEL || "chrome" });
    const page = await browser.newPage();
    await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3000);

    const info = await page.evaluate(() => {
        const fields = [...document.querySelectorAll("input, textarea, select, [role='combobox'], button[type='button']")];
        return fields.slice(0, 80).map((el) => ({
            tag: el.tagName,
            type: el.getAttribute("type"),
            role: el.getAttribute("role"),
            name: el.getAttribute("name"),
            id: el.id,
            ariaLabel: el.getAttribute("aria-label"),
            placeholder: el.getAttribute("placeholder"),
            visible: !!(el.offsetParent),
            label: (() => {
                const id = el.id;
                const explicit = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
                const wrap = el.closest("label");
                const group = el.closest("fieldset, [class*='field'], [class*='question']");
                const heading = group?.querySelector("legend, label, h3, h4, p");
                return [explicit?.innerText, wrap?.innerText, heading?.innerText, el.getAttribute("aria-label")]
                    .filter(Boolean)
                    .join(" | ")
                    .slice(0, 120);
            })()
        }));
    });

    console.log(JSON.stringify({ url: page.url(), title: await page.title(), fields: info }, null, 2));
    await page.screenshot({ path: "artifacts/ashby-debug.png", fullPage: true });
    await page.waitForTimeout(15000);
    await browser.close();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
