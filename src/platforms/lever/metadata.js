const https = require("https");
const { formatCompanyName } = require("../../core/answer-engine");

function parseLeverJobUrl(jobUrl) {
    try {
        const url = new URL(jobUrl);
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length < 2 || !/lever\.co$/i.test(url.hostname)) {
            return { companySlug: null, jobId: null };
        }

        const companySlug = parts[0];
        const jobId = parts[1].replace(/\/apply$/i, "");
        return { companySlug, jobId };
    } catch {
        return { companySlug: null, jobId: null };
    }
}

function resolveLeverApplicationUrl(jobUrl) {
    try {
        const url = new URL(jobUrl);
        if (!/\/apply\/?$/i.test(url.pathname)) {
            url.pathname = `${url.pathname.replace(/\/?$/, "")}/apply`;
        }
        return url.toString();
    } catch {
        return jobUrl;
    }
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

function findPostingById(postings, jobId) {
    if (!postings || !jobId) {
        return null;
    }

    if (Array.isArray(postings)) {
        return postings.find((entry) => entry.id === jobId) || null;
    }

    const values = Object.values(postings);
    return values.find((entry) => entry?.id === jobId) || null;
}

async function fetchLeverJobMetadata(jobUrl) {
    const { companySlug, jobId } = parseLeverJobUrl(jobUrl);
    if (!companySlug || !jobId) {
        return null;
    }

    try {
        const postings = await fetchJson(`https://api.lever.co/v0/postings/${companySlug}?mode=json`);
        const posting = findPostingById(postings, jobId);
        return {
            companySlug,
            jobId,
            title: posting?.text?.split("\n")[0] || null,
            location: posting?.categories?.location || posting?.categories?.allLocations?.[0] || null,
            companyName: formatCompanyName(companySlug),
            applyUrl: posting?.applyUrl || resolveLeverApplicationUrl(jobUrl)
        };
    } catch {
        return {
            companySlug,
            jobId,
            title: null,
            location: null,
            companyName: formatCompanyName(companySlug),
            applyUrl: resolveLeverApplicationUrl(jobUrl)
        };
    }
}

module.exports = {
    fetchLeverJobMetadata,
    parseLeverJobUrl,
    resolveLeverApplicationUrl
};
