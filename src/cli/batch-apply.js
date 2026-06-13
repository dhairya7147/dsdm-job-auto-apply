const http = require("http");
const { discover } = require("../platforms/greenhouse/discover");

const API_BASE = process.env.JOB_AUTO_APPLY_API || "http://127.0.0.1:8080";
const LIMIT = Number(process.env.BATCH_LIMIT || 6);
const POLL_MS = Number(process.env.BATCH_POLL_MS || 5000);
const TIMEOUT_MS = Number(process.env.BATCH_TIMEOUT_MS || 180000);

function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(path, API_BASE);
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request({
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method,
            headers: body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}
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

async function waitForJob(id) {
    const deadline = Date.now() + TIMEOUT_MS;

    while (Date.now() < deadline) {
        const { body } = await request("GET", `/api/applications/${id}`);
        if (["COMPLETED", "FAILED"].includes(body.status)) {
            return body;
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }

    throw new Error(`Timed out waiting for job ${id}`);
}

async function run() {
    const boards = await discover();
    const sample = boards.slice(0, LIMIT);
    const summary = [];

    for (const board of sample) {
        const created = await request("POST", "/api/applications", { jobUrl: board.url });
        const job = created.body;
        process.stdout.write(`${JSON.stringify({
            timestamp: new Date().toISOString(),
            event: "job_submitted",
            board: board.board,
            id: job.id,
            url: board.url
        })}\n`);

        try {
            const finished = await waitForJob(job.id);
            const ready = parseEvent(finished.logs, "ready_for_review");
            const failed = parseEvent(finished.logs, "failed");

            summary.push({
                board: board.board,
                title: board.title,
                url: board.url,
                status: finished.status,
                exitCode: finished.exitCode,
                filled: ready?.filled ?? null,
                unanswered: ready?.unanswered ?? [],
                unansweredCount: ready?.unanswered?.length ?? null,
                companyName: ready?.companyName ?? null,
                resumeUploaded: ready?.resumeUploaded ?? null,
                error: failed?.message ?? null,
                artifactDirectory: finished.artifactDirectory
            });
        } catch (error) {
            summary.push({
                board: board.board,
                title: board.title,
                url: board.url,
                status: "TIMEOUT",
                error: error.message
            });
        }
    }

    const totals = {
        tested: summary.length,
        completed: summary.filter((item) => item.status === "COMPLETED").length,
        failed: summary.filter((item) => item.status === "FAILED").length,
        avgFilled: Math.round(
            summary.filter((item) => item.filled !== null).reduce((sum, item) => sum + item.filled, 0)
            / Math.max(summary.filter((item) => item.filled !== null).length, 1)
        ),
        discoveredBoards: boards.length
    };

    process.stdout.write(`${JSON.stringify({ event: "batch_summary", totals, results: summary }, null, 2)}\n`);
}

run().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
});
