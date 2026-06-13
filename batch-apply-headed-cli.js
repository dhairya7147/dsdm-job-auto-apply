const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { syncPendingAnswers } = require("./sync-pending-answers");

const JOBS_FILE = process.env.JOB_URLS_FILE || "job-urls.json";
const BATCH_OFFSET = Number(process.env.BATCH_OFFSET || 0);
const BATCH_LIMIT = Number(process.env.BATCH_LIMIT || 10);
const BATCH_CONCURRENCY = Number(process.env.BATCH_CONCURRENCY || 10);
const REVIEW_TIMEOUT_MS = Number(process.env.REVIEW_TIMEOUT_MS ?? -1);
const BASE_DIR = __dirname;

function loadJobs() {
    const resolved = path.resolve(BASE_DIR, JOBS_FILE);
    const jobs = JSON.parse(fs.readFileSync(resolved, "utf8"));
    if (!Array.isArray(jobs) || jobs.length === 0) {
        throw new Error(`${resolved} must contain a non-empty job array`);
    }
    return jobs.slice(BATCH_OFFSET, BATCH_OFFSET + BATCH_LIMIT);
}

function jobSlug(job, index) {
    const match = job.url.match(/jobs\/(\d+)|gh_jid=(\d+)/i);
    return match?.[1] || match?.[2] || String(index + 1);
}

function parseEventLine(line) {
    try {
        return JSON.parse(line);
    } catch {
        return null;
    }
}

function runJob(job, index) {
    const slug = jobSlug(job, index);
    const company = String(job.company || "job").toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const artifactDir = path.join(
        BASE_DIR,
        "artifacts",
        `gh-headed-${BATCH_OFFSET + index + 1}-${company}-${slug}`
    );

    return new Promise((resolve) => {
        process.stdout.write(`${JSON.stringify({
            event: "headed_job_started",
            index: BATCH_OFFSET + index + 1,
            company: job.company,
            url: job.url,
            artifactDir
        })}\n`);

        const child = spawn(
            process.execPath,
            [
                path.join(BASE_DIR, "apply.js"),
                job.url,
                "--artifact-dir",
                artifactDir,
                "--review-timeout-ms",
                String(REVIEW_TIMEOUT_MS)
            ],
            {
                cwd: BASE_DIR,
                stdio: ["ignore", "pipe", "pipe"],
                env: {
                    ...process.env,
                    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH?.includes("cursor-sandbox-cache")
                        ? undefined
                        : process.env.PLAYWRIGHT_BROWSERS_PATH
                }
            }
        );

        let settled = false;
        let stdoutBuffer = "";
        let readyEvent = null;
        let failedEvent = null;

        const settle = (summary) => {
            if (settled) {
                return;
            }
            settled = true;
            child.unref();
            resolve(summary);
        };

        const handleChunk = (chunk, stream) => {
            const text = chunk.toString();
            process.stdout.write(text);
            stdoutBuffer += text;

            let newlineIndex = stdoutBuffer.indexOf("\n");
            while (newlineIndex >= 0) {
                const line = stdoutBuffer.slice(0, newlineIndex).trim();
                stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
                const event = parseEventLine(line);
                if (event?.event === "ready_for_review") {
                    readyEvent = event;
                    settle({
                        event: "headed_job_ready",
                        index: BATCH_OFFSET + index + 1,
                        company: job.company,
                        url: job.url,
                        artifactDir,
                        filled: event.filled ?? null,
                        unanswered: event.unanswered ?? [],
                        screenshotPath: event.screenshotPath ?? null,
                        pid: child.pid,
                        message: "Browser left open for manual submit"
                    });
                } else if (event?.event === "failed") {
                    failedEvent = event;
                    settle({
                        event: "headed_job_failed",
                        index: BATCH_OFFSET + index + 1,
                        company: job.company,
                        url: job.url,
                        artifactDir,
                        error: event.message,
                        pid: child.pid,
                        message: "Browser may still be open for manual recovery"
                    });
                }
                newlineIndex = stdoutBuffer.indexOf("\n");
            }

            if (stream === "stderr" && text.trim()) {
                process.stderr.write(text);
            }
        };

        child.stdout.on("data", (chunk) => handleChunk(chunk, "stdout"));
        child.stderr.on("data", (chunk) => handleChunk(chunk, "stderr"));

        child.on("exit", (exitCode) => {
            if (settled) {
                return;
            }

            if (readyEvent) {
                settle({
                    event: "headed_job_ready",
                    index: BATCH_OFFSET + index + 1,
                    company: job.company,
                    url: job.url,
                    artifactDir,
                    exitCode,
                    filled: readyEvent.filled ?? null,
                    unanswered: readyEvent.unanswered ?? [],
                    screenshotPath: readyEvent.screenshotPath ?? null
                });
                return;
            }

            settle({
                event: exitCode === 0 ? "headed_job_completed" : "headed_job_failed",
                index: BATCH_OFFSET + index + 1,
                company: job.company,
                url: job.url,
                artifactDir,
                exitCode,
                error: failedEvent?.message ?? null
            });
        });
    });
}

async function runChunk(jobs, chunkIndex, chunkCount) {
    process.stdout.write(`${JSON.stringify({
        event: "headed_chunk_started",
        chunk: chunkIndex + 1,
        chunkCount,
        jobsInChunk: jobs.length,
        concurrency: BATCH_CONCURRENCY
    })}\n`);

    return Promise.all(jobs.map((job, index) => runJob(job, chunkIndex * BATCH_CONCURRENCY + index)));
}

async function run() {
    const jobs = loadJobs();
    const chunks = [];
    for (let index = 0; index < jobs.length; index += BATCH_CONCURRENCY) {
        chunks.push(jobs.slice(index, index + BATCH_CONCURRENCY));
    }

    process.stdout.write(`${JSON.stringify({
        event: "headed_batch_started",
        jobsFile: JOBS_FILE,
        offset: BATCH_OFFSET,
        limit: BATCH_LIMIT,
        count: jobs.length,
        concurrency: BATCH_CONCURRENCY,
        reviewTimeoutMs: REVIEW_TIMEOUT_MS,
        mode: "parallel-headed"
    })}\n`);

    const summary = [];
    for (let index = 0; index < chunks.length; index += 1) {
        summary.push(...await runChunk(chunks[index], index, chunks.length));
    }

    const pending = syncPendingAnswers(BASE_DIR);
    const totals = {
        tested: summary.length,
        ready: summary.filter((item) => item.event === "headed_job_ready").length,
        completed: summary.filter((item) => item.event === "headed_job_completed").length,
        failed: summary.filter((item) => item.event === "headed_job_failed").length
    };

    process.stdout.write(`${JSON.stringify({
        event: "headed_batch_summary",
        totals,
        pending,
        results: summary,
        hint: "All filled browsers stay open. Review each tab, submit manually, then close browsers when done."
    }, null, 2)}\n`);

    if (totals.failed > 0 && totals.ready === 0) {
        process.exitCode = 1;
    }
}

run().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});
