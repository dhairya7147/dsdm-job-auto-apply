const { chromium } = require("playwright");

const URLS = [
    "https://jobs.ashbyhq.com/salient/a213eea8-ef18-40cb-b693-67ca3900c7fb/application",
    "https://jobs.ashbyhq.com/factory/372c8423-be64-463e-9bdd-0dbeb361b81e/application"
];

async function inspect(page, url) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2500);

    return page.evaluate(() => {
        function labelFor(el) {
            const id = el.id;
            const explicit = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
            const wrap = el.closest("label");
            let node = el.parentElement;
            let heading = "";
            for (let i = 0; i < 6 && node; i += 1) {
                const h = node.querySelector(":scope > label, :scope > h3, :scope > h4, :scope > p, :scope > span");
                if (h && h.innerText.trim()) {
                    heading = h.innerText.trim();
                    break;
                }
                node = node.parentElement;
            }
            return [explicit?.innerText, wrap?.innerText, heading, el.getAttribute("aria-label"), el.name]
                .filter(Boolean)
                .join(" | ")
                .replace(/\s+/g, " ")
                .trim();
        }

        const seen = new Set();
        const fields = [];
        for (const el of document.querySelectorAll("input, textarea, select, [role='combobox']")) {
            const key = `${el.tagName}:${el.name}:${el.id}:${el.type}`;
            if (seen.has(key)) continue;
            seen.add(key);
            if (el.type === "hidden") continue;
            fields.push({
                tag: el.tagName,
                type: el.type || null,
                role: el.getAttribute("role"),
                name: el.name,
                id: el.id,
                visible: !!el.offsetParent,
                label: labelFor(el).slice(0, 140)
            });
        }

        const radioGroups = {};
        for (const el of document.querySelectorAll("input[type='radio']")) {
            if (!radioGroups[el.name]) {
                radioGroups[el.name] = { question: labelFor(el).split("|")[0], options: [] };
            }
            const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
            radioGroups[el.name].options.push(lbl?.innerText?.trim() || el.id);
        }

        return { title: document.title, fields, radioGroups };
    });
}

async function main() {
    const browser = await chromium.launch({
        headless: true,
        channel: process.env.JOB_AUTO_APPLY_BROWSER_CHANNEL || undefined
    });
    const page = await browser.newPage();

    for (const url of URLS) {
        const data = await inspect(page, url);
        console.log("\n===", url, "===");
        console.log(JSON.stringify(data, null, 2));
    }

    await browser.close();
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
