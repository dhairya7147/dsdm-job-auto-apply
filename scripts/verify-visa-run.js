const fs = require("fs");

function analyze(logs = []) {
    const events = logs.map((line) => {
        try {
            return JSON.parse(line.message || line);
        } catch {
            return null;
        }
    }).filter(Boolean);

    const get = (predicate) => events.filter(predicate);
    const filled = (field, index) => get((e) => e.event === "field_filled" && e.field === field && e.index === index);
    const dateOk = (index, kind) => get((e) => e.event === "workday_date_fill_success" && e.experienceIndex === index && e.dateKind === kind);

    const checks = {
        alteryxTitle: filled("Job Title", 0).length > 0,
        alteryxCompany: filled("Company", 0).length > 0,
        alteryxLocation: filled("Location", 0).length > 0,
        alteryxStart: dateOk(0, "start").length > 0,
        alteryxEnd: dateOk(0, "end").length > 0,
        dtdlTitle: filled("Job Title", 1).length > 0,
        dtdlCompany: filled("Company", 1).length > 0,
        dtdlLocation: filled("Location", 1).length > 0,
        dtdlCurrent: filled("I currently work here", 1).length > 0,
        dtdlStart: dateOk(1, "start").length > 0,
        addAnother: get((e) => e.event === "workday_work_experience_add_another_clicked").length > 0,
        school: get((e) => e.event === "field_filled" && e.field === "School or University").length > 0,
        fieldOfStudy: get((e) => e.event === "field_filled" && e.field === "Field of Study").length > 0,
        resume: get((e) => e.event === "resume_uploaded").length > 0,
        twoRows: get((e) => e.event === "workday_experience_row_ready" && e.index === 1 && e.titleCount >= 2).length > 0
    };

    const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
    return { checks, failed, pass: failed.length === 0 };
}

if (require.main === module) {
    const path = process.argv[2];
    const raw = JSON.parse(fs.readFileSync(path, "utf8"));
    const result = analyze(raw.logs || []);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.pass ? 0 : 1);
}

module.exports = { analyze };
