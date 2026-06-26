const test = require("node:test");
const assert = require("node:assert/strict");
const { isEnglishLanguage, looksEnglish, needsEnglish } = require("../../src/core/page-translation");

test("detects english and non-english page samples", () => {
    assert.equal(isEnglishLanguage("en"), true);
    assert.equal(isEnglishLanguage("en-US"), true);
    assert.equal(isEnglishLanguage("pt-BR"), false);

    assert.equal(looksEnglish("Software Engineer application form"), true);
    assert.equal(looksEnglish("Candidatura à vaga para Software Engineer"), false);
    assert.equal(needsEnglish({ lang: "pt", sample: "Candidatura à vaga" }), true);
    assert.equal(needsEnglish({ lang: "en", sample: "Apply for this job" }), false);
});
