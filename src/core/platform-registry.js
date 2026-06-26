const PLATFORMS = [
    {
        id: "greenhouse",
        matches: (url) => /greenhouse\.io/i.test(url.hostname) || /gh_jid=/i.test(url.search)
    },
    {
        id: "workday",
        matches: (url) => /myworkdayjobs\.com/i.test(url.hostname)
    },
    {
        id: "ashby",
        matches: (url) => /ashbyhq\.com/i.test(url.hostname)
    },
    {
        id: "lever",
        matches: (url) => /lever\.co/i.test(url.hostname)
    },
    {
        id: "smartrecruiters",
        matches: (url) => /smartrecruiters\.com/i.test(url.hostname)
    }
];

function detectPlatform(jobUrl) {
    const url = new URL(jobUrl);
    const platform = PLATFORMS.find((entry) => entry.matches(url));
    return platform?.id || null;
}

function requirePlatform(jobUrl) {
    const platform = detectPlatform(jobUrl);
    if (!platform) {
        throw new Error(`Unsupported job application platform for URL: ${jobUrl}`);
    }
    return platform;
}

module.exports = {
    PLATFORMS,
    detectPlatform,
    requirePlatform
};
