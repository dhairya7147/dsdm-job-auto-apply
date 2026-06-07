const test = require("node:test");
const assert = require("node:assert/strict");
const { getAnswer, getCountryAnswer, normalizeQuestion } = require("../answer-engine");

const profile = {
    firstName: "Jane",
    state: "New York",
    currentEmployer: "Example Corp",
    desiredSalary: {
        display: "USD 150,000"
    },
    workAuthorizationByCountry: {
        India: "Yes",
        default: "No"
    },
    sponsorshipRequiredByCountry: {
        India: "No",
        default: "Yes"
    },
    source: "Company website"
};

test("matches common application questions", () => {
    assert.equal(getAnswer("How did you hear about this job?", profile), "Company website");
    assert.equal(getAnswer("Current employer", profile), "Example Corp");
    assert.equal(getAnswer("State / Province", profile), "New York");
    assert.equal(getAnswer("What is your expected salary?", profile), "USD 150,000");
});

test("does not invent an answer", () => {
    assert.equal(getAnswer("Are you authorized to work in the United Kingdom?", profile), null);
    assert.equal(getAnswer("Will you require sponsorship?", profile), null);
});

test("resolves authorization using the job country", () => {
    assert.equal(
        getAnswer("Are you authorized to work in this country?", profile, { targetCountry: "India" }),
        "Yes"
    );
    assert.equal(
        getAnswer("Will you require sponsorship?", profile, { targetCountry: "United Kingdom" }),
        "Yes"
    );
    assert.equal(getCountryAnswer(profile.workAuthorizationByCountry, null), null);
});

test("normalizes labels", () => {
    assert.equal(normalizeQuestion(" First   Name * "), "First Name");
});
