const { runStandalone } = require("./src/core/apply-runner");

function parseArguments(argv) {
    const options = {
        jobUrl: argv[2],
        profilePath: process.env.JOB_AUTO_APPLY_PROFILE || "profile.json",
        headless: process.env.JOB_AUTO_APPLY_HEADLESS === "true",
        reviewTimeoutMs: Number(process.env.JOB_AUTO_APPLY_REVIEW_TIMEOUT_MS ?? -1),
        artifactDir: process.env.JOB_AUTO_APPLY_ARTIFACT_DIR || "artifacts/manual",
        jobLocation: process.env.JOB_AUTO_APPLY_JOB_LOCATION || null,
        onlyStep: process.env.JOB_AUTO_APPLY_ONLY_STEP || null
    };

    for (let index = 3; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === "--headless") options.headless = true;
        else if (argument === "--profile") options.profilePath = argv[++index];
        else if (argument === "--artifact-dir") options.artifactDir = argv[++index];
        else if (argument === "--review-timeout-ms") options.reviewTimeoutMs = Number(argv[++index]);
        else if (argument === "--job-location") options.jobLocation = argv[++index];
        else if (argument === "--only-step") options.onlyStep = argv[++index];
    }

    if (!options.jobUrl) {
        throw new Error("Usage: node apply.js <job-url> [--headless] [--profile path]");
    }

    const url = new URL(options.jobUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
        throw new Error("Job URL must use http or https");
    }

    return options;
}

async function run() {
    const options = parseArguments(process.argv);
    const result = await runStandalone(options);
    if (!result.ok) {
        process.exitCode = 1;
    }
}

run().catch((error) => {
    process.stderr.write(`${JSON.stringify({
        timestamp: new Date().toISOString(),
        event: "failed",
        message: error.message,
        stack: error.stack
    })}\n`);
    process.exitCode = 1;
});
