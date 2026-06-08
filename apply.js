const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { recordUnanswered } = require("./answer-ledger");
const { prepareGreenhouseApplication } = require("./greenhouse-adapter");
const { loadProfile } = require("./profile-loader");

function parseArguments(argv) {
    const options = {
        jobUrl: argv[2],
        profilePath: process.env.JOB_AUTO_APPLY_PROFILE || "profile.json",
        headless: process.env.JOB_AUTO_APPLY_HEADLESS === "true",
        reviewTimeoutMs: Number(process.env.JOB_AUTO_APPLY_REVIEW_TIMEOUT_MS ?? -1),
        artifactDir: process.env.JOB_AUTO_APPLY_ARTIFACT_DIR || "artifacts/manual"
    };

    for (let index = 3; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "--headless") options.headless = true;
        else if (argument === "--profile") options.profilePath = argv[++index];
        else if (argument === "--artifact-dir") options.artifactDir = argv[++index];
        else if (argument === "--review-timeout-ms") options.reviewTimeoutMs = Number(argv[++index]);
    }

    if (!options.jobUrl) {
        throw new Error("Usage: node apply.js <job-url> [--headless] [--profile path]");
    }

    const url = new URL(options.jobUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("Job URL must use http or https");
    }

    return options;
}

function createEmitter() {
    return (event, details = {}) => {
        process.stdout.write(`${JSON.stringify({
            timestamp: new Date().toISOString(),
            event,
            ...details
        })}\n`);
    };
}

async function run() {
    const options = parseArguments(process.argv);
    const emit = createEmitter();
    const profile = loadProfile(options.profilePath);
    const artifactDir = path.resolve(options.artifactDir);
    fs.mkdirSync(artifactDir, { recursive: true });

    emit("started", { jobUrl: options.jobUrl, headless: options.headless });

    // Emit some environment info that helps debug Playwright launch problems
    emit("debug_env", {
        PATH: process.env.PATH,
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || null,
        node: process.execPath
    });

    let browser;
    try {
        browser = await chromium.launch({ headless: options.headless });
    } catch (err) {
        // Provide extra diagnostic info if the browser fails to launch
        const localBrowsersPath = path.join(__dirname, "node_modules", "playwright", ".local-browsers");
        const hasLocalBrowsers = fs.existsSync(localBrowsersPath);
        emit("browser_launch_failed", {
            message: err.message,
            stack: err.stack,
            localBrowsersPath,
            hasLocalBrowsers
        });
        throw err;
    }

    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();

    try {
        page.on("console", (message) => {
            if (message.type() === "error") emit("browser_console_error", { message: message.text() });
        });

        await page.goto(options.jobUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
        emit("page_loaded", { title: await page.title(), finalUrl: page.url() });

        const result = await prepareGreenhouseApplication(page, profile, emit);
        const ledger = recordUnanswered({
            questions: result.unanswered,
            jobUrl: options.jobUrl,
            companyName: result.companyName,
            baseDir: path.dirname(options.profilePath),
            artifactDir
        });

        await page.waitForTimeout(1000);
        const screenshotPath = path.join(artifactDir, "prepared-form.png");
        await page.screenshot({ path: screenshotPath, fullPage: true });

        emit("ready_for_review", {
            ...result,
            screenshotPath,
            ledgerPath: ledger.ledgerPath,
            message: "Application was prepared but not submitted"
        });

        if (result.unanswered.length > 0) {
            emit("unanswered_recorded", {
                count: result.unanswered.length,
                questions: ledger.unanswered,
                hint: "Add answers to pending-answers.json, re-run, then node promote-answers.js"
            });
        }

        if (!options.headless) {
            if (options.reviewTimeoutMs < 0) {
                emit("awaiting_manual_review", {
                    message: "Browser will stay open until you close it"
                });
                await new Promise((resolve) => browser.on("disconnected", resolve));
            } else if (options.reviewTimeoutMs > 0) {
                await page.waitForTimeout(options.reviewTimeoutMs);
            }
        }

        emit("completed", { submitted: false });
    } finally {
        if (browser?.isConnected()) {
            await browser.close();
        }
    }
}

run().catch((error) => {
    process.stderr.write(`${JSON.stringify({
        timestamp: new Date().toISOString(),
        event: "failed",
        message: error.message,
        stack: error.stack
    })}\n`);
    process.exitCode = 1;
});
