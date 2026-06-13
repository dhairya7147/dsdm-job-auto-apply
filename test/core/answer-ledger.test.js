const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
    cleanQuestionLabel,
    mergePendingAnswers,
    promotePendingAnswers,
    recordUnanswered
} = require("../../src/core/answer-ledger");

test("cleans noisy greenhouse labels", () => {
    assert.equal(
        cleanQuestionLabel("Website Website question_36487438002"),
        "Website"
    );
});

test("merges pending answers into the profile", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-auto-apply-"));
    fs.mkdirSync(path.join(directory, "data"), { recursive: true });
    fs.writeFileSync(path.join(directory, "data", "pending-answers.json"), JSON.stringify({
        "Are you currently located in the US?": "No"
    }));

    const profile = mergePendingAnswers({ customAnswers: { Existing: "Yes" } }, directory);
    assert.equal(profile.customAnswers.Existing, "Yes");
    assert.equal(profile.customAnswers["Are you currently located in the US?"], "No");
});

test("records unanswered questions in the ledger and artifact file", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-auto-apply-"));
    const artifactDir = path.join(directory, "artifacts", "job-1");

    const result = recordUnanswered({
        questions: ["Website Website question_36487438002"],
        jobUrl: "https://example.com/job",
        companyName: "Discord",
        baseDir: directory,
        artifactDir
    });

    assert.equal(result.added, 1);
    assert.equal(fs.existsSync(path.join(artifactDir, "unanswered.json")), true);
    assert.equal(fs.existsSync(path.join(directory, "data", "unanswered-ledger.json")), true);
});

test("promotes filled pending answers and keeps empty ones", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-auto-apply-"));
    const profilePath = path.join(directory, "profile.json");
    fs.mkdirSync(path.join(directory, "data"), { recursive: true });
    fs.writeFileSync(profilePath, JSON.stringify({ customAnswers: {}, companyMotivations: {} }));
    fs.writeFileSync(path.join(directory, "data", "pending-answers.json"), JSON.stringify({
        "Why Example?": "Because.",
        "GitHub": "https://github.com/example",
        "Website": "",
        "Are you legally authorized to work in the United States?": "No"
    }));

    const result = promotePendingAnswers(profilePath, directory);
    const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
    const remaining = JSON.parse(fs.readFileSync(path.join(directory, "data", "pending-answers.json"), "utf8"));

    assert.equal(result.promoted, 2);
    assert.equal(result.skippedAuthorization, 1);
    assert.equal(result.keptEmpty, 1);
    assert.equal(profile.companyMotivations.Example, "Because.");
    assert.equal(profile.github, "https://github.com/example");
    assert.equal(remaining.Website, "");
    assert.equal(remaining["Are you legally authorized to work in the United States?"], undefined);
});
