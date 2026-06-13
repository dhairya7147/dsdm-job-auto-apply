const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveExperienceBracketAnswer } = require("../../src/core/experience-policy");

const profile = { experienceYears: 2 };

test("answers experience bracket questions from years of experience", () => {
    assert.equal(resolveExperienceBracketAnswer("Do you have at least 10+ years of total relevant technical experience?", profile), "No");
    assert.equal(resolveExperienceBracketAnswer("Do you have at least 5 years of full time relevant working experience?", profile), "No");
    assert.equal(resolveExperienceBracketAnswer("Do you have at least 2 years of experience?", profile), "Yes");
    assert.equal(resolveExperienceBracketAnswer("Do you have 2-4 years of experience?", profile), "Yes");
    assert.equal(resolveExperienceBracketAnswer("Do you have 0-3 years of experience?", profile), "Yes");
    assert.equal(resolveExperienceBracketAnswer("Do you have a minimum of 3+ years of engineering management experience?", profile), "No");
});
