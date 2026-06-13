const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { recordUnanswered } = require("./answer-ledger");
const { prepareApplication } = require("./application-preparer");
const { buildApplicationContext, resolveGreenhouseApplyUrl } = require("./job-context");
const { resolveAshbyApplicationUrl } = require("../platforms/ashby/metadata");
const { detectPlatform } = require("./platform-registry");
const { loadProfile } = require("./profile-loader");
const { DEFAULT_WORKDAY_PASSWORD, resolveWorkdayAuthPlan } = require("../platforms/workday/accounts");

function buildLaunchOptions(headless) {
    const launchOptions = { headless };
    const browserChannel = process.env.JOB_AUTO_APPLY_BROWSER_CHANNEL;
    if (browserChannel) {
        launchOptions.channel = browserChannel;
    }

    if (process.env.PLAYWRIGHT_BROWSERS_PATH?.includes("cursor-sandbox-cache")) {
        delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    }

    return launchOptions;
}

async function runApplication({
    page,
    profile,
    emit,
    jobUrl,
    profilePath = "profile.json",
    artifactDir = "artifacts/manual",
    headless = false,
    reviewTimeoutMs = -1,
    jobLocation = null,
    onlyStep = null,
    keepBrowserOpen = false
}) {
    const resolvedArtifactDir = path.resolve(artifactDir);
    fs.mkdirSync(resolvedArtifactDir, { recursive: true });

    page.on("console", (message) => {
        if (message.type() === "error") {
            emit("browser_console_error", { message: message.text() });
        }
    });

    const platform = detectPlatform(jobUrl);
    let navigationUrl = jobUrl;
    if (platform === "greenhouse") {
        navigationUrl = resolveGreenhouseApplyUrl(jobUrl);
    } else if (platform === "ashby") {
        navigationUrl = resolveAshbyApplicationUrl(jobUrl);
    }
    if (navigationUrl !== jobUrl) {
        emit("apply_url_resolved", { originalUrl: jobUrl, navigationUrl });
    }

    await page.goto(navigationUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    emit("page_loaded", { title: await page.title(), finalUrl: page.url() });

    const applicationContext = await buildApplicationContext(jobUrl, {
        jobLocation: jobLocation || undefined
    });
    applicationContext.headless = headless;
    applicationContext.baseDir = path.dirname(path.resolve(profilePath));
    applicationContext.workdayPassword = process.env.JOB_AUTO_APPLY_WORKDAY_PASSWORD
        || profile.workdayPassword
        || DEFAULT_WORKDAY_PASSWORD;
    applicationContext.workdayAuthMode = process.env.JOB_AUTO_APPLY_WORKDAY_AUTH_MODE
        || profile.workdayAuthMode
        || "auto";
    applicationContext.artifactDir = resolvedArtifactDir;
    applicationContext.onlyStep = onlyStep;
    if (onlyStep) {
        emit("workday_only_step", { onlyStep });
    }
    emit("workday_auth_plan", resolveWorkdayAuthPlan(applicationContext, profile));
    emit("job_context_resolved", applicationContext);

    const result = await prepareApplication(page, profile, emit, applicationContext);
    const unanswered = [...new Set([
        ...result.unanswered,
        ...(result.manualReviewRequired || [])
    ])];
    const ledger = recordUnanswered({
        questions: unanswered,
        jobUrl,
        companyName: result.companyName,
        baseDir: path.dirname(path.resolve(profilePath)),
        artifactDir: resolvedArtifactDir
    });

    await page.waitForTimeout(400);
    const screenshotPath = path.join(resolvedArtifactDir, "prepared-form.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });

    emit("ready_for_review", {
        ...result,
        screenshotPath,
        ledgerPath: ledger.ledgerPath,
        message: "Application was prepared but not submitted"
    });

    if (unanswered.length > 0) {
        emit("unanswered_recorded", {
            count: unanswered.length,
            questions: ledger.unanswered,
            hint: "Add answers to pending-answers.json, re-run, then node promote-answers.js"
        });
    }

    return {
        result,
        unanswered,
        screenshotPath,
        ledger
    };
}

async function launchBrowser(headless, emit) {
    const launchOptions = buildLaunchOptions(headless);
    emit("browser_launch_options", {
        headless,
        channel: launchOptions.channel || "chromium"
    });

    try {
        return await chromium.launch(launchOptions);
    } catch (err) {
        const localBrowsersPath = path.join(__dirname, "node_modules", "playwright", ".local-browsers");
        emit("browser_launch_failed", {
            message: err.message,
            stack: err.stack,
            localBrowsersPath,
            hasLocalBrowsers: fs.existsSync(localBrowsersPath)
        });
        throw err;
    }
}

async function runStandalone(options, emit = null) {
    const profile = loadProfile(options.profilePath);
    const emitEvent = emit || ((event, details = {}) => {
        process.stdout.write(`${JSON.stringify({
            timestamp: new Date().toISOString(),
            event,
            ...details
        })}\n`);
    });

    emitEvent("started", { jobUrl: options.jobUrl, headless: options.headless });
    emitEvent("debug_env", {
        PATH: process.env.PATH,
        PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || null,
        node: process.execPath
    });

    let browser;
    let page;
    const keepBrowserOpen = !options.headless && options.reviewTimeoutMs < 0;

    try {
        browser = await launchBrowser(options.headless, emitEvent);
        const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
        page = await context.newPage();

        await runApplication({
            page,
            profile,
            emit: emitEvent,
            jobUrl: options.jobUrl,
            profilePath: options.profilePath,
            artifactDir: options.artifactDir,
            headless: options.headless,
            reviewTimeoutMs: options.reviewTimeoutMs,
            jobLocation: options.jobLocation,
            onlyStep: options.onlyStep
        });

        if (!options.headless) {
            if (options.reviewTimeoutMs < 0) {
                emitEvent("awaiting_manual_review", {
                    message: "Browser will stay open until you close it"
                });
                await new Promise((resolve) => browser.on("disconnected", resolve));
            } else if (options.reviewTimeoutMs > 0) {
                await page.waitForTimeout(options.reviewTimeoutMs);
            }
        }

        emitEvent("completed", { submitted: false });
        return { ok: true };
    } catch (error) {
        emitEvent("failed", { message: error.message, stack: error.stack });

        if (!options.headless && page && browser?.isConnected()) {
            const failureScreenshotPath = path.join(path.resolve(options.artifactDir), "failure-state.png");
            await page.screenshot({ path: failureScreenshotPath, fullPage: true }).catch(() => {});
            emitEvent("failure_screenshot", { screenshotPath: failureScreenshotPath });

            if (options.reviewTimeoutMs < 0) {
                emitEvent("awaiting_manual_review", {
                    message: "Run failed; browser will stay open until you close it"
                });
                await new Promise((resolve) => browser.on("disconnected", resolve));
            } else if (options.reviewTimeoutMs > 0) {
                emitEvent("awaiting_manual_review", {
                    message: `Run failed; browser will stay open for ${options.reviewTimeoutMs}ms`
                });
                await page.waitForTimeout(options.reviewTimeoutMs);
            }
        }

        return { ok: false, error };
    } finally {
        if (!keepBrowserOpen && browser?.isConnected()) {
            await browser.close();
        }
    }
}

module.exports = {
    buildLaunchOptions,
    launchBrowser,
    runApplication,
    runStandalone
};
