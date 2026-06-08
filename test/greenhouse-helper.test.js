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

test("matches common demographic option wording", () => {
    assert.equal(optionMatches("Asian (including Indian)", "Asian"), true);
    assert.equal(optionMatches("I am not a protected veteran", "No"), true);
    assert.equal(optionMatches("No, I do not have a disability", "No"), true);
    assert.equal(optionMatches("Yes", "No"), false);
});
