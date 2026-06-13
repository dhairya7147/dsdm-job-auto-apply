const test = require("node:test");
const assert = require("node:assert/strict");
const { findBestOption, optionMatches, resolveOptionMatch } = require("../greenhouse-helper");

test("finds partial school and degree matches", () => {
    const schools = ["Select...", "Motilal Nehru National Institute of Technology", "Other"];
    assert.equal(
        findBestOption(schools, "Motilal Nehru National Institute of Technology"),
        "Motilal Nehru National Institute of Technology"
    );
    assert.equal(findBestOption(["Select...", "Bachelor's Degree", "Master's Degree"], "Bachelor's"), "Bachelor's Degree");
    assert.equal(
        resolveOptionMatch(["Select...", "Other", "MIT"], "Motilal Nehru National Institute of Technology", "Other"),
        "Other"
    );
    assert.equal(optionMatches("Woman", "Female"), true);
});

test("prefers India over British Indian Ocean Territory", () => {
    const countries = [
        "British Indian Ocean Territory",
        "India",
        "Indiana",
        "Indonesia"
    ];

    assert.equal(findBestOption(countries, "India"), "India");
    assert.equal(optionMatches("British Indian Ocean Territory", "India"), false);
    assert.equal(optionMatches("Indiana", "India"), false);
    assert.equal(optionMatches("India (+91)", "India"), true);
});

test("matches common demographic option wording", () => {
    assert.equal(optionMatches("Asian (including Indian)", "Asian"), true);
    assert.equal(optionMatches("I am not a protected veteran", "No"), true);
    assert.equal(optionMatches("No, I do not have a disability", "No"), true);
    assert.equal(optionMatches("Yes", "No"), false);
    assert.equal(
        optionMatches(
            "I IDENTIFY AS ONE OR MORE OF THE CLASSIFICATIONS OF PROTECTED VETERANS LISTED ABOVE",
            "I am not a protected veteran"
        ),
        false
    );
    assert.equal(
        optionMatches("I AM NOT A PROTECTED VETERAN", "I am not a protected veteran"),
        true
    );
    assert.equal(
        findBestOption(
            [
                "I IDENTIFY AS ONE OR MORE OF THE CLASSIFICATIONS OF PROTECTED VETERANS LISTED ABOVE",
                "I AM NOT A PROTECTED VETERAN",
                "I DON'T WISH TO ANSWER"
            ],
            "I am not a protected veteran"
        ),
        "I AM NOT A PROTECTED VETERAN"
    );
});
