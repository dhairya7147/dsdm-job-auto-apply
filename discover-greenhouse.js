const https = require("https");

const BOARDS = [
    "discord", "stripe", "figma", "notion", "airbnb", "cloudflare", "gitlab",
    "mongodb", "reddit", "doordash", "instacart", "pinterest", "lyft", "block",
    "asana", "dropbox", "hubspot", "twilio", "okta", "snowflake", "ramp", "brex",
    "plaid", "scaleai", "anthropic", "openai", "vercel", "linear", "retool",
    "carta", "gusto", "hashicorp", "databricks", "coinbase", "robinhood"
];

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { "User-Agent": "job-auto-apply-discovery/1.0" } }, (response) => {
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

async function discover() {
    const results = [];

    for (const board of BOARDS) {
        try {
            const data = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs`);
            const jobs = data.jobs || [];
            if (jobs.length === 0) {
                continue;
            }

            const engineering = jobs.find((job) => /engineer|developer|software|backend|frontend|platform|infra/i.test(job.title));
            const pick = engineering || jobs[0];

            results.push({
                board,
                jobCount: jobs.length,
                title: pick.title,
                url: pick.absolute_url,
                id: pick.id
            });
        } catch {
            // Board token missing or unavailable.
        }
    }

    return results.sort((left, right) => left.board.localeCompare(right.board));
}

if (require.main === module) {
    discover()
        .then((results) => {
            process.stdout.write(`${JSON.stringify({ discovered: results.length, boards: results }, null, 2)}\n`);
        })
        .catch((error) => {
            process.stderr.write(`${error.message}\n`);
            process.exitCode = 1;
        });
}

module.exports = { BOARDS, discover };
