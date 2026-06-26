const https = require("https");
const { formatCompanyName } = require("../../core/answer-engine");

function parseSmartRecruitersJobUrl(jobUrl) {
    try {
        const url = new URL(jobUrl);
        if (!/smartrecruiters\.com$/i.test(url.hostname)) {
            return { companySlug: null, jobId: null, publicationUuid: null };
        }

        const parts = url.pathname.split("/").filter(Boolean);
        if (parts[0] === "oneclick-ui" && parts[1] === "company" && parts[3] === "publication" && parts[4]) {
            return {
                companySlug: parts[2],
                jobId: null,
                publicationUuid: parts[4]
            };
        }

        if (parts.length >= 2) {
            return {
                companySlug: parts[0],
                jobId: parts[1].replace(/-.*$/, ""),
                publicationUuid: null
            };
        }
    } catch {
        return { companySlug: null, jobId: null, publicationUuid: null };
    }

    return { companySlug: null, jobId: null, publicationUuid: null };
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

function buildOneclickApplyUrl(companySlug, publicationUuid) {
    return `https://jobs.smartrecruiters.com/oneclick-ui/company/${companySlug}/publication/${publicationUuid}?dcr_ci=${companySlug}`;
}

async function fetchSmartRecruitersJobMetadata(jobUrl) {
    const { companySlug, jobId, publicationUuid } = parseSmartRecruitersJobUrl(jobUrl);
    if (!companySlug || (!jobId && !publicationUuid)) {
        return null;
    }

    try {
        const postingPath = publicationUuid
            ? `https://api.smartrecruiters.com/v1/companies/${companySlug}/postings/${publicationUuid}`
            : `https://api.smartrecruiters.com/v1/companies/${companySlug}/postings/${jobId}`;
        const posting = await fetchJson(postingPath);
        const uuid = posting.uuid || publicationUuid;
        return {
            companySlug,
            jobId: posting.id || jobId,
            publicationUuid: uuid,
            title: posting.name || null,
            location: posting.location?.fullLocation || posting.location?.city || null,
            companyName: posting.company?.name || formatCompanyName(companySlug),
            applyUrl: uuid ? buildOneclickApplyUrl(companySlug, uuid) : jobUrl
        };
    } catch {
        return {
            companySlug,
            jobId,
            publicationUuid,
            title: null,
            location: null,
            companyName: formatCompanyName(companySlug),
            applyUrl: publicationUuid ? buildOneclickApplyUrl(companySlug, publicationUuid) : jobUrl
        };
    }
}

async function resolveSmartRecruitersApplicationUrl(jobUrl) {
    const metadata = await fetchSmartRecruitersJobMetadata(jobUrl);
    return metadata?.applyUrl || jobUrl;
}

module.exports = {
    buildOneclickApplyUrl,
    fetchSmartRecruitersJobMetadata,
    parseSmartRecruitersJobUrl,
    resolveSmartRecruitersApplicationUrl
};
