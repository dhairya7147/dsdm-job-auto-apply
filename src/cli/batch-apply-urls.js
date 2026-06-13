const fs = require("fs");
const http = require("http");
const path = require("path");
const { execSync } = require("child_process");
const { syncPendingAnswers } = require("./sync-pending-answers");

const API_BASE = process.env.JOB_AUTO_APPLY_API || "http://127.0.0.1:8080";
const JOBS_FILE = process.env.JOB_URLS_FILE || "data/greenhouse/job-urls.json";
const HEADED = process.env.HEADED === "true" || process.argv.includes("--headed");
const CONCURRENCY = Number(process.env.BATCH_CONCURRENCY || 10);
const BATCH_OFFSET = Number(process.env.BATCH_OFFSET || 0);
const BATCH_LIMIT = Number(process.env.BATCH_LIMIT || 0);
const POLL_MS = Number(process.env.BATCH_POLL_MS || 3000);
const TIMEOUT_MS = Number(process.env.BATCH_TIMEOUT_MS || (HEADED ? 600000 : 300000));
const OPEN_SCREENSHOTS = process.env.OPEN_SCREENSHOTS === "true";
const TERMINAL_STATUSES = HEADED
    ? ["READY_FOR_REVIEW", "COMPLETED", "FAILED"]
    : ["COMPLETED", "FAILED"];

function request(method, pathName, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(pathName, API_BASE);
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method,
            headers: body ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload)
            } : {}
        }, (res) => {
            let data = "";
            res.on("data", (chunk) => { data += chunk; });
            res.on("end", () => {
                try {
                    resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
                } catch (error) {
                    reject(error);
                }
            });
        });

        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function parseEvent(logs, eventName) {
    for (let index = logs.length - 1; index >= 0; index -= 1) {
        const message = logs[index].message;
        if (!message.includes(`"event":"${eventName}"`)) {
            continue;
        }

        try {
            return JSON.parse(message);
        } catch {
            return null;
        }
    }

    return null;
}

function loadJobs() {
    const resolved = path.resolve(JOBS_FILE);
    const jobs = JSON.parse(fs.readFileSync(resolved, "utf8"));
    if (!Array.isArray(jobs) || jobs.length === 0) {
        throw new Error(`${resolved} must contain a non-empty job array`);
    }

    const offset = Math.max(BATCH_OFFSET, 0);
    const limit = BATCH_LIMIT > 0 ? BATCH_LIMIT : jobs.length;
    return jobs.slice(offset, offset + limit);
}

function chunkJobs(jobs, size) {
    const chunks = [];
    for (let index = 0; index < jobs.length; index += size) {
        chunks.push(jobs.slice(index, index + size));
    }
    return chunks;
}

async function submitJob(job) {
    const payload = {
        jobUrl: job.url,
        jobLocation: job.location || null
    };

    if (HEADED) {
        payload.headless = false;
        payload.reviewTimeoutMs = -1;
    } else {
        payload.headless = true;
        payload.reviewTimeoutMs = 5000;
    }

    const created = await request("POST", "/api/applications", payload);

    if (created.status !== 202) {
        throw new Error(`Submit failed (${created.status}) for ${job.url}`);
    }

    return {
        ...job,
        id: created.body.id
    };
}

async function waitForJobs(submitted) {
    const pending = new Set(submitted.map((job) => job.id));
    const results = new Map();
    const deadline = Date.now() + TIMEOUT_MS;

    while (pending.size > 0 && Date.now() < deadline) {
        for (const id of [...pending]) {
            const { body } = await request("GET", `/api/applications/${id}`);
            if (!TERMINAL_STATUSES.includes(body.status)) {
                continue;
            }

            const ready = parseEvent(body.logs, "ready_for_review");
            const failed = parseEvent(body.logs, "failed");
            const screenshotPath = ready?.screenshotPath
                || (body.artifactDirectory ? path.join(body.artifactDirectory, "prepared-form.png") : null);

            results.set(id, {
                status: body.status,
                exitCode: body.exitCode,
                filled: ready?.filled ?? null,
                unansweredCount: ready?.unanswered?.length ?? null,
                companyName: ready?.companyName ?? null,
                targetCountry: ready?.targetCountry ?? null,
                resumeUploaded: ready?.resumeUploaded ?? null,
                screenshotPath,
                error: failed?.message ?? null,
                artifactDirectory: body.artifactDirectory
            });
            pending.delete(id);
        }

        if (pending.size > 0) {
            await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        }
    }

    for (const job of submitted) {
        if (!results.has(job.id)) {
            results.set(job.id, {
                status: "TIMEOUT",
                error: `Timed out after ${TIMEOUT_MS}ms`
            });
        }
    }

    return results;
}

function openScreenshots(summary) {
    const screenshots = summary
        .map((item) => item.screenshotPath)
        .filter((item) => item && fs.existsSync(item));

    if (!screenshots.length) {
        return;
    }

    if (process.platform === "darwin") {
        execSync(`open ${screenshots.map((item) => JSON.stringify(item)).join(" ")}`);
        return;
    }

    process.stdout.write(`Screenshots:\n${screenshots.map((item) => `- ${item}`).join("\n")}\n`);
}

async function runChunk(chunk, chunkIndex, chunkCount) {
    process.stdout.write(`${JSON.stringify({
        event: "batch_chunk_started",
        chunk: chunkIndex + 1,
        chunkCount,
        jobsInChunk: chunk.length,
        concurrency: CONCURRENCY
    })}\n`);

    const submitted = await Promise.all(chunk.map((job) => submitJob(job)));
    const results = await waitForJobs(submitted);

    return submitted.map((job) => ({
        company: job.company,
        title: job.title,
        location: job.location,
        url: job.url,
        id: job.id,
        ...results.get(job.id)
    }));
}

async function run() {
    const jobs = loadJobs();
    const chunks = chunkJobs(jobs, CONCURRENCY);

    process.stdout.write(`${JSON.stringify({
        event: "batch_started",
        totalJobs: jobs.length,
        chunks: chunks.length,
        concurrency: CONCURRENCY,
        offset: BATCH_OFFSET,
        mode: HEADED ? "headed-chunked" : "headless-chunked"
    })}\n`);

    const summary = [];
    for (let index = 0; index < chunks.length; index += 1) {
        const chunkSummary = await runChunk(chunks[index], index, chunks.length);
        summary.push(...chunkSummary);
    }

    const totals = {
        tested: summary.length,
        readyForReview: summary.filter((item) => item.status === "READY_FOR_REVIEW").length,
        completed: summary.filter((item) => item.status === "COMPLETED").length,
        failed: summary.filter((item) => item.status === "FAILED").length,
        timedOut: summary.filter((item) => item.status === "TIMEOUT").length,
        avgFilled: Math.round(
            summary.filter((item) => item.filled !== null).reduce((sum, item) => sum + item.filled, 0)
            / Math.max(summary.filter((item) => item.filled !== null).length, 1)
        )
    };

    process.stdout.write(`${JSON.stringify({ event: "batch_summary", totals, results: summary }, null, 2)}\n`);

    if (HEADED) {
        process.stdout.write(`${JSON.stringify({
            event: "headed_review_hint",
            message: "Review browsers chunk by chunk. Close each browser when done before starting the next batch wave if needed."
        })}\n`);
    }

    if (OPEN_SCREENSHOTS) {
        openScreenshots(summary);
    }

    const pending = syncPendingAnswers(process.cwd());
    process.stdout.write(`${JSON.stringify({
        event: "pending_synced",
        added: pending.added,
        removed: pending.removed,
        totalPending: pending.totalPending,
        unansweredStillEmpty: pending.unansweredStillEmpty,
        hint: pending.totalPending > 0
            ? "Answer remaining items in pending-answers.json, then run: npm run promote-answers"
            : "No pending gaps after sync"
    }, null, 2)}\n`);
}

run().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});
