const https = require("https");
const { extractCountryFromText } = require("../../core/authorization-policy");
const { formatCompanyName } = require("../../core/answer-engine");

function parseWorkdayJobUrl(jobUrl) {
    try {
        const url = new URL(jobUrl);
        const hostMatch = url.hostname.match(/^([^.]+)\.(wd\d+)\.myworkdayjobs\.com$/i);
        if (!hostMatch) {
            return null;
        }

        const parts = url.pathname.split("/").filter(Boolean);
        const jobIndex = parts.indexOf("job");
        if (jobIndex < 1) {
            return null;
        }

        const locale = /^[a-z]{2}-[A-Z]{2}$/.test(parts[0]) ? parts[0] : null;
        const site = parts[jobIndex - 1];
        const slugParts = parts.slice(jobIndex + 1).filter((part) => !/^(apply|autofillWithResume)$/i.test(part));

        return {
            tenant: hostMatch[1],
            instance: hostMatch[2],
            host: url.hostname,
            locale,
            site,
            slug: slugParts.join("/"),
            externalPath: `/job/${slugParts.join("/")}`,
            applyUrl: `${url.origin}${locale ? `/${locale}` : ""}/${site}/job/${slugParts.join("/")}/apply`
        };
    } catch {
        return null;
    }
}

function fetchJson(hostname, path, body = null) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const request = https.request({
            hostname,
            path,
            method: body ? "POST" : "GET",
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "job-auto-apply-workday/1.0",
                ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {})
            }
        }, (response) => {
            let data = "";
            response.on("data", (chunk) => { data += chunk; });
            response.on("end", () => {
                if (response.statusCode !== 200) {
                    reject(new Error(`${response.statusCode} for https://${hostname}${path}`));
                    return;
                }

                try {
                    resolve(JSON.parse(data));
                } catch (error) {
                    reject(error);
                }
            });
        });

        request.on("error", reject);
        if (payload) {
            request.write(payload);
        }
        request.end();
    });
}

async function fetchWorkdayJobMetadata(jobUrl) {
    const parsed = parseWorkdayJobUrl(jobUrl);
    if (!parsed) {
        return null;
    }

    try {
        const listing = await fetchJson(
            parsed.host,
            `/wday/cxs/${parsed.tenant}/${parsed.site}/jobs`,
            { appliedFacets: {}, limit: 20, offset: 0, searchText: "" }
        );

        const posting = (listing.jobPostings || []).find((job) => job.externalPath === parsed.externalPath)
            || (listing.jobPostings || []).find((job) => parsed.slug && job.externalPath?.includes(parsed.slug.split("/").pop()));

        return {
            ...parsed,
            title: posting?.title || null,
            location: posting?.locationsText || null,
            companyName: formatCompanyName(parsed.tenant),
            targetCountry: extractCountryFromText([posting?.locationsText, parsed.slug].filter(Boolean).join(" "))
        };
    } catch {
        return {
            ...parsed,
            title: null,
            location: null,
            companyName: formatCompanyName(parsed.tenant),
            targetCountry: extractCountryFromText(parsed.slug || "")
        };
    }
}

module.exports = {
    fetchJson,
    fetchWorkdayJobMetadata,
    parseWorkdayJobUrl
};
