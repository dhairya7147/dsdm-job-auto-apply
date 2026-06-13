const { chromium } = require("playwright");
const { loadProfile } = require("../profile-loader");
const { completeWorkdayAuth } = require("../workday-helper");
const { openApplication, detectCurrentStep } = require("../workday-adapter");

const JOB_URL = "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/Israel-Yokneam/Software-Engineer--SPE_JR2015623";
const PASSWORD = process.argv[2] || "password";

async function dumpFields(page) {
    return page.evaluate(() => {
        return [...document.querySelectorAll("input, textarea, select, [role='combobox'], button[aria-haspopup='listbox']")]
            .filter((el) => el.offsetParent !== null && !el.disabled)
            .map((el) => ({
                tag: el.tagName.toLowerCase(),
                type: el.getAttribute("type"),
                automationId: el.getAttribute("data-automation-id"),
                ariaLabel: el.getAttribute("aria-label")
            }));
    });
}

async function main() {
    const profile = loadProfile("profile.json");
    const emit = (event, d = {}) => console.log(JSON.stringify({ event, ...d }));

    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

    await page.goto(JOB_URL, { waitUntil: "domcontentloaded" });
    await openApplication(page, JOB_URL, emit);
    await completeWorkdayAuth(page, profile, emit, { workdayPassword: PASSWORD, workdayAuthMode: "sign_in" });

    for (const waitMs of [0, 3000, 6000, 10000, 15000]) {
        if (waitMs > 0) await page.waitForTimeout(waitMs);
        const step = await detectCurrentStep(page);
        const fields = await dumpFields(page);
        console.log(JSON.stringify({ waitMs, step, fieldCount: fields.length, fields: fields.slice(0, 25) }, null, 2));
    }

    await browser.close();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
