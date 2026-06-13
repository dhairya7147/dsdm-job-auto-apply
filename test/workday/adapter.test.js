const test = require("node:test");
const assert = require("node:assert/strict");
const {
    isAccountGateStepLabel,
    isApplicationStepLabel,
    matchesWorkdayStep,
    parseWorkdayStep
} = require("../../src/platforms/workday/adapter");

const PROGRESS_TEXT = `current step 2 of 5
Create Account/Sign In
step 2 of 5
My Information
step 3 of 5
My Experience
step 4 of 5
Voluntary Disclosures
step 5 of 5
Review`;

test("parses the active workday step from progress text", () => {
    const stepInfo = parseWorkdayStep(PROGRESS_TEXT);

    assert.equal(stepInfo.step, 2);
    assert.equal(stepInfo.total, 5);
    assert.equal(stepInfo.label, "My Information");
});

test("does not treat sidebar progress text alone as the account gate", () => {
    const stepInfo = parseWorkdayStep(PROGRESS_TEXT);

    assert.equal(isAccountGateStepLabel(stepInfo.label), false);
    assert.equal(isApplicationStepLabel(stepInfo.label), true);
});

test("matches my experience from step label or step key", () => {
    assert.equal(
        matchesWorkdayStep("my experience", { step: 2, label: "My Experience" }, /my experience/),
        true
    );
    assert.equal(
        matchesWorkdayStep("step:2", { step: 2, label: "My Experience" }, /my experience/),
        true
    );
    assert.equal(
        matchesWorkdayStep("my information", { step: 1, label: "My Information" }, /my experience/),
        false
    );
});

test("detects the account gate only on the account step label", () => {
    const accountStep = parseWorkdayStep(`current step 1 of 5
Create Account/Sign In
step 2 of 5
My Information`);

    assert.equal(accountStep.label, "Create Account/Sign In");
    assert.equal(isAccountGateStepLabel(accountStep.label), true);
});
