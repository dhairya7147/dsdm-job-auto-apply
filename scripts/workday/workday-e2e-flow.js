const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { loadProfile } = require("../../src/core/profile-loader");
const { prepareWorkdayApplication, detectCurrentStep } = require("../../src/platforms/workday/adapter");
const { buildApplicationContext } = require("../../src/core/job-context");

const JOB_URL = process.argv[2]
    || "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/Israel-Yokneam/Software-Engineer--SPE_JR2015623";
const { DEFAULT_WORKDAY_PASSWORD } = require("../../src/platforms/workday/accounts");
const PASSWORD = process.argv[3] || DEFAULT_WORKDAY_PASSWORD;
const ARTIFACT_DIR = path.resolve("artifacts/workday-e2e");

function emit(event, details = {}) {
    const line = JSON.stringify({ event, ...details });
    console.log(line);
    return line;
}

async function dumpPageState(page, label) {
    const stepInfo = await detectCurrentStep(page);
    const bodySnippet = await page.locator("body").innerText().catch(() => "");
    const fields = await page.evaluate(() => {
        return [...document.querySelectorAll("input, textarea, select, [role='combobox'], button[aria-haspopup='listbox']")]
            .filter((el) => el.offsetParent !== null && !el.disabled)
            .slice(0, 40)
            .map((el) => ({
                tag: el.tagName.toLowerCase(),
                type: el.getAttribute("type"),
                automationId: el.getAttribute("data-automation-id"),
                value: el.value || el.textContent?.slice(0, 40) || "",
                ariaLabel: el.getAttribute("aria-label")
            }));
    });

    emit("page_state", {
        label,
        url: page.url(),
        stepInfo,
        fieldCount: fields.length,
        fields,
        bodySnippet: bodySnippet.slice(0, 800)
    });
}

async function main() {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const profile = loadProfile("profile.json");

    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

    const applicationContext = await buildApplicationContext(JOB_URL);
    applicationContext.headless = true;
    applicationContext.baseDir = path.dirname(path.resolve("profile.json"));
    applicationContext.workdayPassword = PASSWORD;
    applicationContext.workdayAuthMode = "auto";

    try {
        emit("starting", { jobUrl: JOB_URL, email: profile.email, password: PASSWORD });

        await page.goto(JOB_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

        const result = await prepareWorkdayApplication(page, profile, emit, {
            ...applicationContext,
            jobUrl: JOB_URL
        });

        await dumpPageState(page, "after_prepare");
        await page.screenshot({ path: path.join(ARTIFACT_DIR, "after-prepare.png"), fullPage: true });

        emit("result", result);

        if (result.filled === 0) {
            process.exitCode = 1;
        }
    } catch (error) {
        emit("failed", { message: error.message, stack: error.stack });
        await page.screenshot({ path: path.join(ARTIFACT_DIR, "failure.png"), fullPage: true }).catch(() => {});
        process.exitCode = 1;
    } finally {
        await browser.close();
    }
}

main();
