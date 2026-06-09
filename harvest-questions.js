const https = require("https");
const { extractCountryFromText } = require("./authorization-policy");
const { getAnswer, normalizeQuestion } = require("./answer-engine");
const { recordUnanswered, cleanQuestionLabel } = require("./answer-ledger");
const { loadProfile } = require("./profile-loader");
const { uniqueBoards } = require("./greenhouse-boards");

const JOBS_PER_BOARD = Number(process.env.HARVEST_JOBS_PER_BOARD || 2);
const BOARD_LIMIT = Number(process.env.HARVEST_BOARD_LIMIT || 100);
const PROFILE_PATH = process.env.JOB_AUTO_APPLY_PROFILE || "profile.json";

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { "User-Agent": "job-auto-apply-harvest/1.0" } }, (response) => {
            let body = "";
            response.on("data", (chunk) => { body += chunk; });
            response.on("end", () => {
                if (response.statusCode !== 200) {
                    reject(new Error(`${response.statusCode} for ${url}`));
                    return;
                }

                try {
                    resolve(JSON.parse(body));
                } catch (error) {
                    reject(error);
                }
            });
        }).on("error", reject);
    });
}

const IGNORE_PATTERNS = [
    /^first name$/i,
    /^last name$/i,
    /^email$/i,
    /^phone$/i,
    /^resume/i,
    /^cover letter/i,
    /^attach$/i,
    /^longitude$/i,
    /^latitude$/i,
    /^location$/i,
    /verification code/i,
    /security.code/i,
    /confirm you.?re a human/i,
    /voluntary self-identification/i,
    /equal employment opportunity/i,
    /government reporting purposes/i,
    /^school school--/i,
    /^degree degree--/i,
    /^discipline discipline--/i,
    /^country phone$/i,
    /^location \(city\) candidate-location$/i
];

function shouldIgnoreQuestion(label) {
    const cleaned = cleanQuestionLabel(label);
    return !cleaned || IGNORE_PATTERNS.some((pattern) => pattern.test(cleaned));
}

function pickJobs(jobs) {
    if (!jobs.length) {
        return [];
    }

    const engineering = jobs.filter((job) =>
        /engineer|developer|software|backend|frontend|platform|infra|data|sre|devops/i.test(job.title)
    );
    const pool = engineering.length ? engineering : jobs;
    const picks = [];
    const seen = new Set();

    for (const job of pool) {
        if (picks.length >= JOBS_PER_BOARD) {
            break;
        }
        if (seen.has(job.id)) {
            continue;
        }
        seen.add(job.id);
        picks.push(job);
    }

    if (picks.length < JOBS_PER_BOARD) {
        for (const job of jobs) {
            if (picks.length >= JOBS_PER_BOARD) {
                break;
            }
            if (seen.has(job.id)) {
                continue;
            }
            seen.add(job.id);
            picks.push(job);
        }
    }

    return picks;
}

function stripHtml(value) {
    return String(value || "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
}

function extractQuestionLabels(jobDetail) {
    const labels = [];

    for (const question of jobDetail.questions || []) {
        if (question.label) {
            labels.push(question.label);
        }
    }

    for (const question of jobDetail.location_questions || []) {
        if (question.label && !/longitude|latitude/i.test(question.label)) {
            labels.push(question.label);
        }
    }

    // Compliance blocks are usually EEOC boilerplate, not fillable questions.

    const demographics = jobDetail.demographic_questions;
    if (demographics?.questions) {
        for (const question of demographics.questions) {
            labels.push(question.label || question.name);
        }
    }

    if (jobDetail.education && jobDetail.education !== "none") {
        labels.push("School", "Degree", "Discipline");
    }

    return [...new Set(labels.map((label) => normalizeQuestion(label)).filter(Boolean))];
}

function detectTargetCountry(jobDetail) {
    const location = [
        jobDetail.location?.name,
        jobDetail.title,
        jobDetail.content
    ].filter(Boolean).join(" ");

    return extractCountryFromText(location);
}

async function harvestBoard(board, profile) {
    const listUrl = `https://boards-api.greenhouse.io/v1/boards/${board}/jobs`;
    const listing = await fetchJson(listUrl);
    const jobs = listing.jobs || [];
    const picks = pickJobs(jobs);
    const gaps = new Set();
    const covered = new Set();
    const inspected = [];

    for (const job of picks) {
        const detailUrl = `https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${job.id}?questions=true`;
        const detail = await fetchJson(detailUrl);
        const companyName = detail.company_name || board;
        const targetCountry = detectTargetCountry(detail);
        const labels = extractQuestionLabels(detail);
        const missing = [];

        for (const label of labels) {
            if (shouldIgnoreQuestion(label)) {
                continue;
            }

            const answer = getAnswer(label, profile, {
                companyName,
                targetCountry,
                jobLocation: detail.location?.name || null
            });
            if (answer) {
                covered.add(cleanQuestionLabel(label));
            } else {
                const cleaned = cleanQuestionLabel(label);
                gaps.add(cleaned);
                missing.push(cleaned);
            }
        }

        if (missing.length > 0) {
            recordUnanswered({
                questions: missing,
                jobUrl: detail.absolute_url || job.absolute_url,
                companyName,
                baseDir: process.cwd()
            });
        }

        inspected.push({
            id: job.id,
            title: job.title,
            url: detail.absolute_url || job.absolute_url,
            questionCount: labels.length,
            missingCount: missing.length
        });
    }

    return {
        board,
        jobCount: jobs.length,
        inspected,
        gaps: [...gaps],
        coveredCount: covered.size
    };
}

async function harvest() {
    const profile = loadProfile(PROFILE_PATH);
    const boards = uniqueBoards().slice(0, BOARD_LIMIT);
    const results = [];
    let totalGaps = new Set();
    let activeBoards = 0;

    for (const board of boards) {
        try {
            const result = await harvestBoard(board, profile);
            if (result.inspected.length === 0) {
                continue;
            }

            activeBoards += 1;
            result.gaps.forEach((gap) => totalGaps.add(gap));
            results.push(result);
        } catch {
            // Board unavailable or private.
        }
    }

    return {
        boardsProbed: boards.length,
        activeBoards,
        jobsInspected: results.reduce((sum, item) => sum + item.inspected.length, 0),
        uniqueGaps: [...totalGaps].sort(),
        uniqueGapCount: totalGaps.size,
        results: results.sort((left, right) => right.gaps.length - left.gaps.length)
    };
}

if (require.main === module) {
    harvest()
        .then((summary) => {
            process.stdout.write(`${JSON.stringify({ event: "harvest_summary", ...summary }, null, 2)}\n`);
        })
        .catch((error) => {
            process.stderr.write(`${error.message}\n`);
            process.exitCode = 1;
        });
}

module.exports = { extractQuestionLabels, harvest, shouldIgnoreQuestion };
