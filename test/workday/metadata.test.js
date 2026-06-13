const test = require("node:test");
const assert = require("node:assert/strict");
const { parseWorkdayJobUrl } = require("../../src/platforms/workday/metadata");

test("parses workday job urls", () => {
    const parsed = parseWorkdayJobUrl(
        "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/Israel-Yokneam/Software-Engineer--SPE_JR2015623/apply"
    );

    assert.equal(parsed.tenant, "nvidia");
    assert.equal(parsed.instance, "wd5");
    assert.equal(parsed.site, "NVIDIAExternalCareerSite");
    assert.equal(parsed.externalPath, "/job/Israel-Yokneam/Software-Engineer--SPE_JR2015623");
    assert.match(parsed.applyUrl, /\/apply$/);
});

test("parses workday urls without locale prefix", () => {
    const parsed = parseWorkdayJobUrl(
        "https://hp.wd5.myworkdayjobs.com/ExternalCareerSite/job/Bangalore-Karnataka-India/Software-Engineer_3152311-1"
    );

    assert.equal(parsed.tenant, "hp");
    assert.equal(parsed.site, "ExternalCareerSite");
    assert.match(parsed.applyUrl, /Bangalore-Karnataka-India\/Software-Engineer_3152311-1\/apply$/);
});
