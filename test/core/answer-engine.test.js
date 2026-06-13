const test = require("node:test");
const assert = require("node:assert/strict");
const {
    formatCompanyName,
    getAnswer,
    getCountryAnswer,
    normalizeQuestion,
    resolveMotivationAnswer
} = require("../../src/core/answer-engine");

const profile = {
    firstName: "Jane",
    state: "New York",
    country: "India",
    citizenship: "India",
    currentEmployer: "Example Corp",
    desiredSalary: {
        display: "USD 150,000"
    },
    workAuthorizationByCountry: {},
    sponsorshipRequiredByCountry: {},
    source: "Company website"
};

test("matches common application questions", () => {
    assert.equal(getAnswer("How did you hear about this job?", profile), "Company website");
    assert.equal(getAnswer("Current employer", profile), "Example Corp");
    assert.equal(getAnswer("State / Province", profile), "New York");
    assert.equal(getAnswer("What is your expected salary?", profile), "USD 150,000");
});

test("derives authorization answers from citizenship when country is known", () => {
    assert.equal(getAnswer("Are you authorized to work in the United Kingdom?", profile), "No");
    assert.equal(
        getAnswer("Will you require sponsorship?", profile, { targetCountry: "United Kingdom" }),
        "Yes"
    );
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

test("uses company-specific motivation when available", () => {
    const motivatedProfile = {
        ...profile,
        genericMotivation: "I like {company}.",
        companyMotivations: {
            Discord: "Discord-specific answer."
        }
    };

    assert.equal(
        getAnswer("Why do you want to work at Discord?", motivatedProfile, { companyName: "Discord" }),
        "Discord-specific answer."
    );
    assert.equal(
        resolveMotivationAnswer(motivatedProfile, { companyName: "Stripe" }),
        "I like Stripe."
    );
});

test("formats greenhouse company slugs", () => {
    assert.equal(formatCompanyName("discord"), "Discord");
    assert.equal(formatCompanyName("airbnb-global"), "Airbnb Global");
});

test("matches location screening questions from profile", () => {
    const locationProfile = {
        ...profile,
        currentlyInUS: "No",
        bayAreaRelocation: "Yes"
    };

    assert.equal(getAnswer("Are you currently located in the US?", locationProfile), "No");
    assert.equal(
        getAnswer("Are you currently based in or willing to relocate to the Bay Area?", locationProfile),
        "Yes"
    );
});

test("does not map first or last name fields to generic Name custom answer", () => {
    const nameProfile = {
        ...profile,
        firstName: "Dhanya",
        lastName: "Nair",
        fullName: "Dhanya Manoj Nair",
        preferredName: "Dhanya",
        customAnswers: {
            Name: "Dhanya Manoj Nair"
        }
    };

    assert.equal(getAnswer("First Name First Name first_name", nameProfile), "Dhanya");
    assert.equal(getAnswer("Last Name Last Name last_name", nameProfile), "Nair");
    assert.equal(getAnswer("Preferred First Name", nameProfile), "Dhanya");
    assert.equal(getAnswer("Name", nameProfile), "Dhanya Manoj Nair");
});
