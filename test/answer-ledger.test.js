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
} = require("../answer-ledger");

test("cleans noisy greenhouse labels", () => {
    assert.equal(
        cleanQuestionLabel("Website Website question_36487438002"),
        "Website Website"
    );
});

test("merges pending answers into the profile", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-auto-apply-"));
    fs.writeFileSync(path.join(directory, "pending-answers.json"), JSON.stringify({
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
    assert.equal(fs.existsSync(path.join(directory, "unanswered-ledger.json")), true);
});

test("promotes pending answers into profile.json", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-auto-apply-"));
    const profilePath = path.join(directory, "profile.json");
    fs.writeFileSync(profilePath, JSON.stringify({ customAnswers: {} }));
    fs.writeFileSync(path.join(directory, "pending-answers.json"), JSON.stringify({
        "Why Example?": "Because."
    }));

    const result = promotePendingAnswers(profilePath, directory);
    const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));

    assert.equal(result.promoted, 1);
    assert.equal(profile.customAnswers["Why Example?"], "Because.");
    assert.equal(fs.existsSync(path.join(directory, "pending-answers.json")), false);
});
