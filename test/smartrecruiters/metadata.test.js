const test = require("node:test");
const assert = require("node:assert/strict");
const {
    buildOneclickApplyUrl,
    fetchSmartRecruitersJobMetadata,
    parseSmartRecruitersJobUrl,
    resolveSmartRecruitersApplicationUrl
} = require("../../src/platforms/smartrecruiters/metadata");

test("parses smartrecruiters job urls", () => {
    const parsed = parseSmartRecruitersJobUrl("https://jobs.smartrecruiters.com/Visa/744000122509268");
    assert.equal(parsed.companySlug, "Visa");
    assert.equal(parsed.jobId, "744000122509268");

    const oneclick = parseSmartRecruitersJobUrl(
        "https://jobs.smartrecruiters.com/oneclick-ui/company/Visa/publication/ded6c65f-7598-4801-981d-13a51716e73b"
    );
    assert.equal(oneclick.companySlug, "Visa");
    assert.equal(oneclick.publicationUuid, "ded6c65f-7598-4801-981d-13a51716e73b");
});

test("builds oneclick apply urls", () => {
    assert.equal(
        buildOneclickApplyUrl("Visa", "ded6c65f-7598-4801-981d-13a51716e73b"),
        "https://jobs.smartrecruiters.com/oneclick-ui/company/Visa/publication/ded6c65f-7598-4801-981d-13a51716e73b?dcr_ci=Visa"
    );
});

test("loads smartrecruiters metadata from api", async () => {
    const metadata = await fetchSmartRecruitersJobMetadata("https://jobs.smartrecruiters.com/Visa/744000122509268");
    assert.equal(metadata.companyName, "Visa");
    assert.equal(metadata.jobId, "744000122509268");
    assert.ok(metadata.applyUrl.includes("oneclick-ui"));
    assert.ok(metadata.publicationUuid);
});

test("resolves smartrecruiters application urls", async () => {
    const applyUrl = await resolveSmartRecruitersApplicationUrl("https://jobs.smartrecruiters.com/DeliveryHero/744000132218895");
    assert.match(applyUrl, /oneclick-ui\/company\/DeliveryHero\/publication\//);
});
