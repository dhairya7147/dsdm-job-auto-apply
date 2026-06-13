const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { loadProfile } = require("../../src/core/profile-loader");

test("loads a valid profile and resolves its resume path", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-auto-apply-"));
    fs.writeFileSync(path.join(directory, "resume.pdf"), "resume");
    fs.writeFileSync(path.join(directory, "profile.json"), JSON.stringify({
        firstName: "Jane",
        lastName: "Doe",
        email: "jane@example.com",
        phone: "555",
        city: "New York",
        country: "United States",
        resume: "resume.pdf"
    }));

    const profile = loadProfile(path.join(directory, "profile.json"));
    assert.equal(profile.resume, path.join(directory, "resume.pdf"));
});

test("rejects incomplete profiles", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "job-auto-apply-"));
    const profilePath = path.join(directory, "profile.json");
    fs.writeFileSync(profilePath, "{}");

    assert.throws(() => loadProfile(profilePath), /missing required fields/);
});
