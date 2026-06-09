const test = require("node:test");
const assert = require("node:assert/strict");
const {
    extractCountryFromText,
    resolveAuthorizationAnswer,
    resolveTargetCountry
} = require("../authorization-policy");
const { getAnswer } = require("../answer-engine");

const indiaProfile = {
    country: "India",
    citizenship: "India",
    workAuthorizationByCountry: {},
    sponsorshipRequiredByCountry: {}
};

test("maps bay area and city hints to countries", () => {
    assert.equal(extractCountryFromText("San Francisco Bay Area"), "United States");
    assert.equal(extractCountryFromText("Gurgaon, India"), "India");
    assert.equal(extractCountryFromText("London, UK"), "United Kingdom");
});

test("resolves india citizen work auth by target country", () => {
    assert.equal(
        resolveAuthorizationAnswer(
            "authorized",
            "Are you legally authorized to work in the United States?",
            indiaProfile
        ),
        "No"
    );
    assert.equal(
        resolveAuthorizationAnswer(
            "sponsorship",
            "Will you now or in the future require visa sponsorship?",
            indiaProfile,
            { targetCountry: "United States" }
        ),
        "Yes"
    );
    assert.equal(
        resolveAuthorizationAnswer(
            "authorized",
            "Are you authorized to work in India?",
            indiaProfile
        ),
        "Yes"
    );
    assert.equal(
        resolveAuthorizationAnswer(
            "sponsorship",
            "Do you require sponsorship in India?",
            indiaProfile
        ),
        "No"
    );
});

test("uses explicit country overrides when provided", () => {
    const profile = {
        citizenship: "India",
        workAuthorizationByCountry: {
            Canada: "Yes"
        },
        sponsorshipRequiredByCountry: {
            Canada: "No"
        }
    };

    assert.equal(
        resolveAuthorizationAnswer("authorized", "Authorized to work in Canada?", profile),
        "Yes"
    );
    assert.equal(
        resolveAuthorizationAnswer("sponsorship", "Require sponsorship in Canada?", profile),
        "No"
    );
});

test("getAnswer wires authorization questions through policy", () => {
    assert.equal(
        getAnswer("Are you authorized to work in the United Kingdom?", indiaProfile),
        "No"
    );
    assert.equal(
        getAnswer("Will you require immigration sponsorship in the UK?", indiaProfile),
        "Yes"
    );
    assert.equal(
        getAnswer("Are you authorized to work in this country?", indiaProfile, { targetCountry: "India" }),
        "Yes"
    );
});

test("resolves target country from question and job location", () => {
    assert.equal(
        resolveTargetCountry("Authorized to work in the stated location?", {
            jobLocation: "San Francisco Bay Area"
        }),
        "United States"
    );
});
