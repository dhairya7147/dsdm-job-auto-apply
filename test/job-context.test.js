const test = require("node:test");
const assert = require("node:assert/strict");
const {
    parseGreenhouseJobUrl,
    resolveTargetCountryFromContext
} = require("../job-context");

test("parses greenhouse job urls", () => {
    assert.deepEqual(
        parseGreenhouseJobUrl("https://job-boards.greenhouse.io/stripe/jobs/7618977"),
        { board: "stripe", jobId: "7618977" }
    );
});

test("resolves target country from job location metadata", () => {
    assert.equal(
        resolveTargetCountryFromContext({ jobLocation: "Remote, India" }),
        "India"
    );
    assert.equal(
        resolveTargetCountryFromContext({ jobLocation: "San Francisco Bay Area" }),
        "United States"
    );
});
