// Public Greenhouse board tokens (careers page slug).
// No master API exists — collected from careers pages and public lists.
const BOARDS = [
    "discord", "stripe", "figma", "notion", "airbnb", "cloudflare", "gitlab",
    "mongodb", "reddit", "doordash", "instacart", "pinterest", "lyft", "block",
    "asana", "dropbox", "hubspot", "twilio", "okta", "snowflake", "ramp", "brex",
    "plaid", "scaleai", "anthropic", "openai", "vercel", "linear", "retool",
    "carta", "gusto", "hashicorp", "databricks", "coinbase", "robinhood",
    "mistralai", "cohere", "huggingface", "runwayml", "character", "glovo",
    "affirm", "mercury", "klarna", "wise", "revolut", "nubank", "flexport",
    "datadog", "airbyte", "confluent", "fastly", "posthog", "loom", "front",
    "airtable", "doctolib", "oscar", "backmarket", "vinted", "etsy", "chewy",
    "whoop", "qonto", "swile", "payfit", "algolia", "kraken", "chainalysis",
    "grammarly", "duolingo", "roblox", "unity", "shopify", "rippling", "chime",
    "netflix", "spotify", "slack", "zoom", "atlassian", "paypal", "square",
    "intercom", "zendesk", "freshworks", "box", "smartsheet", "mondaydotcom",
    "coursera", "khanacademy", "anduril", "palantir", "nuro", "waymo", "cruise",
    "tesla", "rivian", "lucidmotors", "sofi", "affirm", "marqeta", "checkout",
    "adyen", "mollie", "toast", "opentable", "yelp", "grubhub", "uber", "getaround",
    "bird", "lime", "spin", "convoy", "project44", "shipbob", "faire", "flexe",
    "samsara", "verkada", "ring", "nest", "ecobee", "plume", "calm", "headspace",
    "ro", "hims", "nurx", "carbonhealth", "cityblock", "devoted", "cloverhealth",
    "benchling", "ginkgo", "tempus", "color", "23andme", "guardanthealth",
    "stripe", "figma", "notion", "canva", "miro", "amplitude", "mixpanel",
    "segment", "launchdarkly", "pagerduty", "sentry", "datadog", "newrelic",
    "grafana", "cockroachlabs", "planetscale", "supabase", "neon", "render",
    "flyio", "railway", "netlify", "heroku", "digitalocean", "linode",
    "coreweave", "lambda", "anyscale", "weightsandbiases", "labelbox", "scale",
    "snorkel", "datarobot", "h2oai", "stability", "midjourney", "perplexity",
    "pika", "adept", "inflection", "xai", "cohere", "together", "fireworks",
    "replicate", "modal", "baseten", "huggingface", "wandb", "langchain",
    "pinecone", "weaviate", "qdrant", "milvus", "zilliz", "turbopuffer",
    "harvey", "evenup", "casetext", "ironclad", "clio", "docusign", "pandadoc",
    "gong", "chorus", "outreach", "salesloft", "apollo", "zoominfo", "clearbit",
    "6sense", "demandbase", "marketo", "hubspot", "braze", "iterable", "customerio",
    "sendgrid", "mailchimp", "klaviyo", "attentive", "postscript", "yotpo",
    "faire", "shopify", "bigcommerce", "squarespace", "wix", "webflow", "framer",
    "builder", "contentful", "sanity", "strapi", "prismic", "storyblok",
    "gitlab", "github", "bitbucket", "circleci", "buildkite", "travis",
    "codecov", "sonarqube", "snyk", "lacework", "wiz", "orca", "crowdstrike",
    "sentinelone", "zscaler", "paloaltonetworks", "fortinet", "cloudflare",
    "fastly", "akamai", "imperva", "f5", "nginx", "kong", "tyk", "apigee",
    "mulesoft", "boomi", "workato", "tray", "zapier", "make", "n8n",
    "airtable", "smartsheet", "coda", "clickup", "asana", "monday", "basecamp",
    "linear", "height", "shortcut", "jira", "confluence", "notion", "craft",
    "robinhood", "etrade", "schwab", "fidelity", "vanguard", "betterment",
    "wealthfront", "acorns", "stash", "public", "webull", "tastytrade",
    "carta", "pulley", "shareworks", "equityzen", "forge", "hiive",
    "greenhouse", "lever", "ashby", "gem", "beamery", "eightfold", "phenom",
    "iCIMS", "workday", "adp", "paychex", "gusto", "justworks", "deel",
    "remote", "oyster", "papaya", "velocityglobal", "multiplier", "rippling"
];

function uniqueBoards() {
    return [...new Set(BOARDS.map((board) => board.trim().toLowerCase()).filter(Boolean))];
}

module.exports = { BOARDS, uniqueBoards };
