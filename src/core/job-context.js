const https = require("https");
const { extractCountryFromText, normalizeCountry } = require("./authorization-policy");
const { formatCompanyName } = require("./answer-engine");
const { detectPlatform } = require("./platform-registry");
const { fetchAshbyJobMetadata } = require("../platforms/ashby/metadata");
const { fetchWorkdayJobMetadata, parseWorkdayJobUrl } = require("../platforms/workday/metadata");

function inferBoardFromHostname(hostname) {
    const normalized = String(hostname || "").toLowerCase();
    if (!normalized || /greenhouse\.io$/i.test(normalized)) {
        return null;
    }

    const parts = normalized.split(".").filter((part) => part && part !== "www" && part !== "boards");
    return parts[0] || null;
}

function resolveGreenhouseApplyUrl(jobUrl) {
    try {
        const url = new URL(jobUrl);
        const ghJid = url.searchParams.get("gh_jid");

        if (/job-boards\.greenhouse\.io\/embed\/job_app/i.test(jobUrl)) {
            return jobUrl;
        }

        if (/job-boards\.greenhouse\.io\/[^/]+\/jobs\//i.test(jobUrl)
            || /boards\.greenhouse\.io\/[^/]+\/jobs\//i.test(jobUrl)) {
            return jobUrl;
        }

        const { board, jobId } = parseGreenhouseJobUrl(jobUrl);
        const token = jobId || ghJid;
        if (!token || !board) {
            return jobUrl;
        }

        return `https://job-boards.greenhouse.io/embed/job_app?token=${token}&for=${board}&gh_jid=${ghJid || token}`;
    } catch {
        return jobUrl;
    }
}

function parseGreenhouseJobUrl(jobUrl) {
    try {
        const url = new URL(jobUrl);
        const ghJid = url.searchParams.get("gh_jid");
        const parts = url.pathname.split("/").filter(Boolean);
        const jobsIndex = parts.indexOf("jobs");

        if (jobsIndex >= 1 && jobsIndex + 1 < parts.length) {
            return {
                board: parts[jobsIndex - 1],
                jobId: parts[jobsIndex + 1].replace(/\?.*$/, "")
            };
        }

        if (ghJid) {
            return {
                board: inferBoardFromHostname(url.hostname),
                jobId: ghJid
            };
        }
    } catch {
        return { board: null, jobId: null };
    }

    return { board: null, jobId: null };
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { "User-Agent": "job-auto-apply-context/1.0" } }, (response) => {
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

async function fetchGreenhouseJobMetadata(jobUrl) {
    const { board, jobId } = parseGreenhouseJobUrl(jobUrl);
    if (!board || !jobId) {
        return null;
    }

    try {
        const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${jobId}`);
        return {
            board,
            jobId,
            title: data.title || null,
            location: data.location?.name || null,
            companyName: formatCompanyName(board)
        };
    } catch {
        return {
            board,
            jobId,
            title: null,
            location: null,
            companyName: formatCompanyName(board)
        };
    }
}

function resolveTargetCountryFromContext(context = {}) {
    if (context.targetCountry) {
        return normalizeCountry(context.targetCountry);
    }

    const locationText = [context.jobLocation, context.jobTitle, context.jobUrl]
        .filter(Boolean)
        .join(" ");

    return extractCountryFromText(locationText);
}

async function buildApplicationContext(jobUrl, overrides = {}) {
    const platform = detectPlatform(jobUrl);
    let metadata = null;

    if (platform === "workday") {
        metadata = await fetchWorkdayJobMetadata(jobUrl);
    } else if (platform === "greenhouse") {
        metadata = await fetchGreenhouseJobMetadata(jobUrl);
    } else if (platform === "ashby") {
        metadata = await fetchAshbyJobMetadata(jobUrl);
    }

    const jobLocation = overrides.jobLocation || metadata?.location || null;
    const companyName = overrides.companyName || metadata?.companyName || null;
    const targetCountry = resolveTargetCountryFromContext({
        targetCountry: overrides.targetCountry || metadata?.targetCountry,
        jobLocation,
        jobTitle: metadata?.title,
        jobUrl
    });

    return {
        platform,
        jobUrl,
        jobLocation,
        jobTitle: metadata?.title || null,
        companyName,
        targetCountry,
        board: metadata?.board || metadata?.tenant || parseGreenhouseJobUrl(jobUrl).board,
        applyUrl: metadata?.applyUrl || null,
        externalPath: metadata?.externalPath || null
    };
}

module.exports = {
    buildApplicationContext,
    fetchGreenhouseJobMetadata,
    fetchJobMetadata: fetchGreenhouseJobMetadata,
    parseGreenhouseJobUrl,
    resolveGreenhouseApplyUrl,
    resolveTargetCountryFromContext
};
