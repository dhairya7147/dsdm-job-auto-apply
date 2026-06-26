const test = require("node:test");
const assert = require("node:assert/strict");
const {
    fetchLeverJobMetadata,
    parseLeverJobUrl,
    resolveLeverApplicationUrl
} = require("../../src/platforms/lever/metadata");

test("parses lever job urls", () => {
    const parsed = parseLeverJobUrl("https://jobs.lever.co/spotify/b2e65eb5-e558-45d1-b5ee-347cbbf3dae3");
    assert.equal(parsed.companySlug, "spotify");
    assert.equal(parsed.jobId, "b2e65eb5-e558-45d1-b5ee-347cbbf3dae3");
});

test("resolves lever application urls", () => {
    assert.equal(
        resolveLeverApplicationUrl("https://jobs.lever.co/palantir/fe65ee3c-61e0-4eb6-99e5-c90e38e7043f"),
        "https://jobs.lever.co/palantir/fe65ee3c-61e0-4eb6-99e5-c90e38e7043f/apply"
    );
});

test("loads lever metadata from api", async () => {
    const metadata = await fetchLeverJobMetadata("https://jobs.lever.co/spotify/b2e65eb5-e558-45d1-b5ee-347cbbf3dae3");
    assert.equal(metadata.companyName, "Spotify");
    assert.equal(metadata.companySlug, "spotify");
    assert.ok(metadata.applyUrl.endsWith("/apply"));
});
