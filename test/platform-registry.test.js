const test = require("node:test");
const assert = require("node:assert/strict");
const { detectPlatform } = require("../platform-registry");

test("detects greenhouse, workday, and ashby platforms", () => {
    assert.equal(
        detectPlatform("https://job-boards.greenhouse.io/stripe/jobs/7618977"),
        "greenhouse"
    );
    assert.equal(
        detectPlatform("https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/Israel-Yokneam/Software-Engineer--SPE_JR2015623"),
        "workday"
    );
    assert.equal(
        detectPlatform("https://jobs.ashbyhq.com/salient/a213eea8-ef18-40cb-b693-67ca3900c7fb/application"),
        "ashby"
    );
    assert.equal(detectPlatform("https://example.com/jobs/1"), null);
});
