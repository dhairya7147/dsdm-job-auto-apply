const { spawn } = require("child_process");
const path = require("path");
const { discover } = require("./discover");
const { harvest } = require("./harvest-questions");
const { syncPendingAnswers } = require("../../cli/sync-pending-answers");

const FORM_LIMIT = Number(process.env.SWEEP_FORM_LIMIT || 30);
const HARVEST_BOARD_LIMIT = Number(process.env.HARVEST_BOARD_LIMIT || 100);
const PROFILE_PATH = process.env.JOB_AUTO_APPLY_PROFILE || "profile.json";
const HEADLESS = process.env.JOB_AUTO_APPLY_HEADLESS !== "false";

function runApply(jobUrl) {
    return new Promise((resolve) => {
        const args = [
            "apply.js",
            jobUrl,
            "--profile",
            PROFILE_PATH,
            "--artifact-dir",
            path.join("artifacts", `sweep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
            "--review-timeout-ms",
            "0"
        ];

        if (HEADLESS) {
            args.push("--headless");
        }

        const child = spawn("node", args, { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";

        child.stdout.on("data", (chunk) => { stdout += chunk; });
        child.on("close", (code) => {
            const lines = stdout.trim().split("\n").filter(Boolean);
            const events = lines.map((line) => {
                try {
                    return JSON.parse(line);
                } catch {
                    return null;
                }
            }).filter(Boolean);

            const ready = [...events].reverse().find((event) => event.event === "ready_for_review");
            const failed = [...events].reverse().find((event) => event.event === "failed");

            resolve({
                jobUrl,
                exitCode: code,
                filled: ready?.filled ?? null,
                unanswered: ready?.unanswered ?? [],
                companyName: ready?.companyName ?? null,
                error: failed?.message ?? null
            });
        });
    });
}

async function sweepForms(urls) {
    const results = [];

    for (const url of urls.slice(0, FORM_LIMIT)) {
        const result = await runApply(url);
        results.push(result);
        process.stdout.write(`${JSON.stringify({ event: "form_swept", ...result })}\n`);
    }

    return results;
}

async function run() {
    process.env.HARVEST_BOARD_LIMIT = String(HARVEST_BOARD_LIMIT);

    const harvestSummary = await harvest();
    const boards = await discover();
    const formUrls = boards.map((board) => board.url);
    const formResults = await sweepForms(formUrls);
    const pending = syncPendingAnswers(process.cwd());

    const uniqueFormGaps = [...new Set(formResults.flatMap((result) => result.unanswered || []))];

    process.stdout.write(`${JSON.stringify({
        event: "sweep_summary",
        harvest: {
            boardsProbed: harvestSummary.boardsProbed,
            activeBoards: harvestSummary.activeBoards,
            jobsInspected: harvestSummary.jobsInspected,
            uniqueGapCount: harvestSummary.uniqueGapCount,
            topGaps: harvestSummary.uniqueGaps.slice(0, 40)
        },
        forms: {
            tested: formResults.length,
            completed: formResults.filter((result) => result.exitCode === 0).length,
            uniqueUnanswered: uniqueFormGaps.length
        },
        pending
    }, null, 2)}\n`);
}

if (require.main === module) {
    run().catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = { run, sweepForms };
