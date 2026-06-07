const test = require("node:test");
const assert = require("node:assert/strict");
const { optionMatches } = require("../greenhouse-helper");

test("matches common demographic option wording", () => {
    assert.equal(optionMatches("Asian (including Indian)", "Asian"), true);
    assert.equal(optionMatches("I am not a protected veteran", "No"), true);
    assert.equal(optionMatches("No, I do not have a disability", "No"), true);
    assert.equal(optionMatches("Yes", "No"), false);
});
