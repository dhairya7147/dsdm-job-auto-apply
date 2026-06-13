const fs = require("fs");
const path = require("path");
const { launchBrowser, runApplication } = require("./apply-runner");
const { loadProfile } = require("./profile-loader");
const { syncPendingAnswers } = require("./sync-pending-answers");

if (!process.env.JOB_AUTO_APPLY_BROWSER_CHANNEL) {
    process.env.JOB_AUTO_APPLY_BROWSER_CHANNEL = "chrome";
}

const JOBS_FILE = process.env.JOB_URLS_FILE || "job-urls.json";
const BATCH_OFFSET = Number(process.env.BATCH_OFFSET || 0);
const BATCH_LIMIT = Number(process.env.BATCH_LIMIT || 0);
const TAB_DELAY_MS = Number(process.env.TAB_DELAY_MS || 1200);
const PROFILE_PATH = process.env.JOB_AUTO_APPLY_PROFILE || "profile.json";
const BASE_DIR = __dirname;

function loadJobs() {
    const resolved = path.resolve(BASE_DIR, JOBS_FILE);
    const jobs = JSON.parse(fs.readFileSync(resolved, "utf8"));
    if (!Array.isArray(jobs) || jobs.length === 0) {
        throw new Error(`${resolved} must contain a non-empty job array`);
    }

    const end = BATCH_LIMIT > 0 ? BATCH_OFFSET + BATCH_LIMIT : undefined;
    return jobs.slice(BATCH_OFFSET, end);
}

function jobSlug(job, index) {
    const match = job.url.match(/jobs\/(\d+)|gh_jid=(\d+)/i);
    return match?.[1] || match?.[2] || String(index + 1);
}

function createEmitter(prefix = "") {
    return (event, details = {}) => {
        process.stdout.write(`${JSON.stringify({
            timestamp: new Date().toISOString(),
            event,
            prefix,
            ...details
        })}\n`);
    };
}

async function run() {
    const jobs = loadJobs();
    const profile = loadProfile(path.join(BASE_DIR, PROFILE_PATH));
    const emit = createEmitter("batch-tabs");

    emit("tabs_batch_started", {
        jobsFile: JOBS_FILE,
        offset: BATCH_OFFSET,
        limit: BATCH_LIMIT || "all",
        count: jobs.length,
        mode: "single-browser-tabs",
        browser: process.env.JOB_AUTO_APPLY_BROWSER_CHANNEL || "chrome"
    });

    const browser = await launchBrowser(false, emit);
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const summary = [];

    for (let index = 0; index < jobs.length; index += 1) {
        const job = jobs[index];
        const slug = jobSlug(job, index);
        const company = String(job.company || "job").toLowerCase().replace(/[^a-z0-9]+/g, "-");
        const artifactDir = path.join(
            BASE_DIR,
            "artifacts",
            `gh-tabs-${BATCH_OFFSET + index + 1}-${company}-${slug}`
        );
        const jobEmit = createEmitter(`tab-${BATCH_OFFSET + index + 1}`);

        jobEmit("tab_job_started", {
            index: BATCH_OFFSET + index + 1,
            company: job.company,
            url: job.url,
            artifactDir
        });

        const page = await context.newPage();

        try {
            const outcome = await runApplication({
                page,
                profile,
                emit: jobEmit,
                jobUrl: job.url,
                profilePath: path.join(BASE_DIR, PROFILE_PATH),
                artifactDir,
                headless: false,
                reviewTimeoutMs: -1,
                jobLocation: job.location || null
            });

            summary.push({
                event: "tab_job_ready",
                index: BATCH_OFFSET + index + 1,
                company: job.company,
                url: job.url,
                artifactDir,
                filled: outcome.result.filled,
                unanswered: outcome.unanswered
            });
        } catch (error) {
            const failureScreenshotPath = path.join(artifactDir, "failure-state.png");
            await page.screenshot({ path: failureScreenshotPath, fullPage: true }).catch(() => {});
            jobEmit("tab_job_failed", {
                index: BATCH_OFFSET + index + 1,
                company: job.company,
                url: job.url,
                artifactDir,
                error: error.message,
                screenshotPath: failureScreenshotPath
            });
            summary.push({
                event: "tab_job_failed",
                index: BATCH_OFFSET + index + 1,
                company: job.company,
                url: job.url,
                artifactDir,
                error: error.message
            });
        }

        if (index < jobs.length - 1) {
            await page.waitForTimeout(TAB_DELAY_MS);
        }
    }

    const pending = syncPendingAnswers(BASE_DIR);
    const totals = {
        tested: summary.length,
        ready: summary.filter((item) => item.event === "tab_job_ready").length,
        failed: summary.filter((item) => item.event === "tab_job_failed").length
    };

    emit("tabs_batch_summary", {
        totals,
        pending,
        results: summary,
        hint: "One browser with multiple tabs is open. Review each tab, submit manually, then close the browser."
    });

    emit("awaiting_manual_review", {
        message: "All tabs prepared. Browser will stay open until you close it."
    });

    await new Promise((resolve) => browser.on("disconnected", resolve));
}

run().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});
