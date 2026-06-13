const { formatCompanyName } = require("../../core/answer-engine");

function parseAshbyJobUrl(jobUrl) {
    try {
        const url = new URL(jobUrl);
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts.length < 2 || !/ashbyhq\.com$/i.test(url.hostname)) {
            return { companySlug: null, jobId: null };
        }

        const companySlug = parts[0];
        const jobId = parts[1].replace(/\/application$/i, "");
        return { companySlug, jobId };
    } catch {
        return { companySlug: null, jobId: null };
    }
}

function resolveAshbyApplicationUrl(jobUrl) {
    try {
        const url = new URL(jobUrl);
        if (!/\/application\/?$/i.test(url.pathname)) {
            url.pathname = `${url.pathname.replace(/\/?$/, "")}/application`;
        }
        return url.toString();
    } catch {
        return jobUrl;
    }
}

async function fetchAshbyJobMetadata(jobUrl) {
    const { companySlug, jobId } = parseAshbyJobUrl(jobUrl);
    if (!companySlug || !jobId) {
        return null;
    }

    return {
        companySlug,
        jobId,
        title: null,
        location: null,
        companyName: formatCompanyName(companySlug)
    };
}

module.exports = {
    fetchAshbyJobMetadata,
    parseAshbyJobUrl,
    resolveAshbyApplicationUrl
};
