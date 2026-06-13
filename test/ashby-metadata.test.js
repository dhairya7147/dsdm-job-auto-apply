const test = require("node:test");
const assert = require("node:assert/strict");
const {
    fetchAshbyJobMetadata,
    parseAshbyJobUrl,
    resolveAshbyApplicationUrl
} = require("../ashby-metadata");

test("parses ashby job urls", () => {
    const parsed = parseAshbyJobUrl("https://jobs.ashbyhq.com/salient/a213eea8-ef18-40cb-b693-67ca3900c7fb");
    assert.equal(parsed.companySlug, "salient");
    assert.equal(parsed.jobId, "a213eea8-ef18-40cb-b693-67ca3900c7fb");
});

test("resolves ashby application urls", () => {
    assert.equal(
        resolveAshbyApplicationUrl("https://jobs.ashbyhq.com/factory/372c8423-be64-463e-9bdd-0dbeb361b81e"),
        "https://jobs.ashbyhq.com/factory/372c8423-be64-463e-9bdd-0dbeb361b81e/application"
    );
});

test("loads ashby metadata from slug", async () => {
    const metadata = await fetchAshbyJobMetadata("https://jobs.ashbyhq.com/range/c065eea6-197a-45f1-81c8-4e03af60e641/application");
    assert.equal(metadata.companyName, "Range");
    assert.equal(metadata.companySlug, "range");
});
