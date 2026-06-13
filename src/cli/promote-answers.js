const path = require("path");
const { promotePendingAnswers } = require("../core/answer-ledger");

function parseProfilePath(argv) {
    for (let index = 2; index < argv.length; index += 1) {
        if (argv[index] === "--profile") {
            return argv[index + 1];
        }
    }

    return process.env.JOB_AUTO_APPLY_PROFILE || "profile.json";
}

const result = promotePendingAnswers(parseProfilePath(process.argv), process.cwd());
process.stdout.write(`${JSON.stringify({
    timestamp: new Date().toISOString(),
    event: "answers_promoted",
    ...result
})}\n`);
