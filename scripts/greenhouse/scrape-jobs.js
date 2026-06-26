#!/usr/bin/env node
const fs = require("fs");
const https = require("https");
const path = require("path");

const ENG_PATTERN = /engineer|software|developer|backend|platform|sre|devops|data scientist|machine learning/i;

const MANUAL_BOARD_BY_COMPANY = {
    Datadog: "datadog",
    HighRadius: "highradius",
    Rubrik: "rubrik",
    Samsara: "samsara",
    Square: "block",
    Stripe: "stripe",
    "Weights & Biases": "weightsandbiases"
};

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { "User-Agent": "job-auto-apply-scrape/1.0" } }, (response) => {
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

function jobIdFromUrl(url) {
    const ghJid = url.match(/gh_jid=(\d+)/i);
    if (ghJid) {
        return ghJid[1];
    }

    const pathMatch = url.match(/\/jobs\/(\d+)/i);
    return pathMatch ? pathMatch[1] : url;
}

function boardFromUrl(url) {
    const boardParam = url.match(/[?&]board=([^&]+)/i);
    if (boardParam) {
        return boardParam[1];
    }

    const greenhouseMatch = url.match(/greenhouse\.io\/([^/]+)\/jobs/i);
    return greenhouseMatch ? greenhouseMatch[1] : null;
}

function buildCompanyBoardMap(baselineJobs) {
    const map = new Map();

    for (const job of baselineJobs) {
        const board = MANUAL_BOARD_BY_COMPANY[job.company] || boardFromUrl(job.url);
        if (board) {
            map.set(job.company, board.toLowerCase());
        }
    }

    return map;
}

async function scrapeBoard(company, board) {
    const listUrl = `https://boards-api.greenhouse.io/v1/boards/${board}/jobs`;
    const listing = await fetchJson(listUrl);
    const jobs = listing.jobs || [];

    return jobs
        .filter((job) => ENG_PATTERN.test(job.title || ""))
        .map((job) => ({
            company,
            title: job.title,
            location: job.location?.name || null,
            url: job.absolute_url,
            id: String(job.id)
        }));
}

async function scrapeCompanies(companyBoardMap) {
    const results = [];
    const errors = [];

    for (const [company, board] of companyBoardMap.entries()) {
        try {
            const jobs = await scrapeBoard(company, board);
            results.push(...jobs);
            process.stderr.write(`scraped ${company} (${board}): ${jobs.length} eng jobs\n`);
        } catch (error) {
            errors.push({ company, board, error: error.message });
            process.stderr.write(`failed ${company} (${board}): ${error.message}\n`);
        }
    }

    return { results, errors };
}

function dedupeJobs(jobs) {
    const seen = new Set();
    const unique = [];

    for (const job of jobs) {
        const key = job.id || jobIdFromUrl(job.url);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        unique.push(job);
    }

    return unique.sort((left, right) => {
        const company = left.company.localeCompare(right.company);
        return company !== 0 ? company : left.title.localeCompare(right.title);
    });
}

function diffJobs(baselineJobs, freshJobs) {
    const baselineIds = new Set(baselineJobs.map((job) => jobIdFromUrl(job.url)));
    const freshIds = new Set(freshJobs.map((job) => job.id || jobIdFromUrl(job.url)));

    const newJobs = freshJobs.filter((job) => !baselineIds.has(job.id || jobIdFromUrl(job.url)));
    const removedJobs = baselineJobs.filter((job) => !freshIds.has(jobIdFromUrl(job.url)));

    return { newJobs, removedJobs };
}

async function main() {
    const baselinePath = process.argv[2] || path.join(process.env.HOME, "Downloads/greenhouse_jobs_2026-06-19.json");
    const outputPath = process.argv[3] || path.join(process.env.HOME, "Downloads/greenhouse_jobs_2026-06-10.json");

    const baselineJobs = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
    const companyBoardMap = buildCompanyBoardMap(baselineJobs);
    const { results, errors } = await scrapeCompanies(companyBoardMap);
    const freshJobs = dedupeJobs(results.map(({ id, ...job }) => job));
    const { newJobs, removedJobs } = diffJobs(baselineJobs, results);

    fs.writeFileSync(outputPath, `${JSON.stringify(freshJobs, null, 2)}\n`);

    const summary = {
        event: "greenhouse_scrape_summary",
        scrapedAt: new Date().toISOString(),
        baselinePath,
        outputPath,
        companies: companyBoardMap.size,
        baselineCount: baselineJobs.length,
        freshCount: freshJobs.length,
        newCount: newJobs.length,
        removedCount: removedJobs.length,
        errors,
        newJobs: newJobs.map(({ id, ...job }) => job),
        removedJobs
    };

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (require.main === module) {
    main().catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}

module.exports = {
    buildCompanyBoardMap,
    diffJobs,
    scrapeCompanies,
    jobIdFromUrl
};
