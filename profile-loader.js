const fs = require("fs");
const path = require("path");
const { mergePendingAnswers } = require("./answer-ledger");

const REQUIRED_FIELDS = [
    "firstName",
    "lastName",
    "email",
    "phone",
    "city",
    "country",
    "resume"
];

function loadProfile(profilePath) {
    const resolvedPath = path.resolve(profilePath || "profile.json");
    const profile = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
    const missing = REQUIRED_FIELDS.filter((field) => !profile[field]);

    if (missing.length > 0) {
        throw new Error(`Profile is missing required fields: ${missing.join(", ")}`);
    }

    profile.resume = path.resolve(path.dirname(resolvedPath), profile.resume);
    if (!fs.existsSync(profile.resume)) {
        throw new Error(`Resume does not exist: ${profile.resume}`);
    }

    return mergePendingAnswers(profile, path.dirname(resolvedPath));
}

module.exports = {
    loadProfile,
    REQUIRED_FIELDS
};
