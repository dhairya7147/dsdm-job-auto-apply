const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
    hasWorkdayAccount,
    recordWorkdayAccount,
    resolveWorkdayAuthPlan
} = require("../../src/platforms/workday/accounts");

test("creates account on first visit and signs in on repeat visits", () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "workday-accounts-"));

    const firstPlan = resolveWorkdayAuthPlan({ companyName: "Visa", baseDir }, { workdayAuthMode: "auto" });
    assert.deepEqual(firstPlan.modes, ["create_account", "sign_in"]);
    assert.equal(firstPlan.hasAccount, false);

    recordWorkdayAccount({
        companyName: "Visa",
        jobUrl: "https://visa.wd5.myworkdayjobs.com/en-US/Visa/job/example",
        email: "jane@example.com",
        baseDir
    });

    assert.equal(hasWorkdayAccount("Visa", baseDir), true);
    assert.equal(hasWorkdayAccount("visa", baseDir), true);

    const secondPlan = resolveWorkdayAuthPlan({ companyName: "Visa", baseDir }, { workdayAuthMode: "auto" });
    assert.deepEqual(secondPlan.modes, ["sign_in", "create_account"]);
    assert.equal(secondPlan.hasAccount, true);
});

test("honors explicit auth mode overrides", () => {
    const plan = resolveWorkdayAuthPlan(
        { companyName: "Visa" },
        { workdayAuthMode: "create_account" }
    );

    assert.deepEqual(plan.modes, ["create_account"]);
});
