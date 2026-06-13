const path = require("path");
const { extractCountryFromText } = require("./authorization-policy");
const { formatCompanyName, getAnswer, normalizeQuestion } = require("./answer-engine");
const {
    fillAshbyLocationCombobox,
    getAshbyFieldLabel,
    getAshbyRadioGroupQuestion,
    pickAshbyQuestionLabel,
    resolveAshbySystemFieldAnswer,
    selectAshbyRadioGroup
} = require("./ashby-helper");
const { escapeRegExp, fillField, selectOption } = require("./greenhouse-helper");
const { parseAshbyJobUrl } = require("./ashby-metadata");

const FIELD_SELECTOR = [
    "textarea",
    "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='file']):not([type='radio']):not([id^='g-recaptcha'])",
    "select",
    "[role='combobox']"
].join(",");

async function dismissCookieBanner(page, emit) {
    const acceptButton = page.getByRole("button", { name: /accept all|agree and proceed|i agree|got it|allow all/i }).first();
    if (await acceptButton.isVisible().catch(() => false)) {
        await acceptButton.click().catch(() => {});
        await page.waitForTimeout(400);
        emit("cookie_banner_dismissed", {});
    }
}

async function waitForAshbyForm(page) {
    await page.locator("#_systemfield_email, [id='_systemfield_email'], form input[type='email']").first()
        .waitFor({ state: "visible", timeout: 20000 });
}

async function detectCompanyName(page, applicationContext = {}) {
    if (applicationContext.companyName) {
        return applicationContext.companyName;
    }

    const title = await page.title().catch(() => "");
    const titleMatch = title.match(/@\s*(.+?)\s*$/i);
    if (titleMatch) {
        return titleMatch[1].trim();
    }

    const { companySlug } = parseAshbyJobUrl(page.url());
    return companySlug ? formatCompanyName(companySlug) : null;
}

async function detectTargetCountry(page, applicationContext = {}) {
    const text = await page.locator("body").innerText().catch(() => "");
    return applicationContext.targetCountry || extractCountryFromText(text);
}

async function fillAshbyRadioGroups(root, profile, emit, context = {}) {
    const groups = await root.locator("input[type='radio']").evaluateAll((elements) => {
        const names = new Set();
        for (const element of elements) {
            if (element.name) {
                names.add(element.name);
            }
        }
        return [...names];
    });

    let filled = 0;
    const unanswered = [];

    for (const groupName of groups) {
        const { questionLabel } = await getAshbyRadioGroupQuestion(root, groupName);
        if (!questionLabel) {
            continue;
        }
        const answer = getAnswer(questionLabel, profile, context);
        if (!answer) {
            if (questionLabel && !unanswered.includes(questionLabel)) {
                unanswered.push(questionLabel);
            }
            continue;
        }

        try {
            const selected = await selectAshbyRadioGroup(root, groupName, questionLabel, answer);
            filled += 1;
            emit("field_filled", { field: questionLabel, value: selected, type: "radio" });
        } catch (error) {
            emit("field_failed", { field: questionLabel, message: error.message, type: "radio" });
            if (questionLabel && !unanswered.includes(questionLabel)) {
                unanswered.push(questionLabel);
            }
        }
    }

    return { filled, unanswered };
}

async function fillKnownFields(root, profile, emit, context = {}) {
    const fields = root.locator(FIELD_SELECTOR);
    const count = await fields.count();
    const handledKeys = new Set();
    const unanswered = [];
    let filled = 0;

    for (let index = 0; index < count; index += 1) {
        const field = fields.nth(index);
        if (!await field.isVisible().catch(() => false) || !await field.isEnabled().catch(() => false)) {
            continue;
        }

        const type = (await field.getAttribute("type") || "").toLowerCase();
        const role = (await field.getAttribute("role") || "").toLowerCase();
        const name = await field.getAttribute("name") || await field.getAttribute("id") || `field-${index}`;
        const dedupeKey = `${type}:${role}:${name}`;
        if (handledKeys.has(dedupeKey)) {
            continue;
        }
        handledKeys.add(dedupeKey);

        const rawLabel = await getAshbyFieldLabel(field);
        const label = normalizeQuestion(pickAshbyQuestionLabel(rawLabel) || rawLabel);

        let answer = null;
        if (name.startsWith("_systemfield_")) {
            answer = resolveAshbySystemFieldAnswer(name, rawLabel, profile);
        }
        if (!answer) {
            answer = getAnswer(label, profile, context);
        }

        if (!answer) {
            if (label && !unanswered.includes(label)) {
                unanswered.push(label);
            }
            continue;
        }

        try {
            if (role === "combobox") {
                await selectOption(field, answer, root);
            } else {
                await fillField(field, answer, root);
            }
            filled += 1;
            emit("field_filled", { field: label || name });
        } catch (error) {
            emit("field_failed", { field: label || name, message: error.message });
            if (label && !unanswered.includes(label)) {
                unanswered.push(label);
            }
        }
    }

    return { filled, unanswered };
}

async function uploadResume(root, profile, emit) {
    if (!profile.resume) {
        return false;
    }

    const resumePath = path.resolve(profile.resume);
    const resumeInput = root.locator("#_systemfield_resume").first();
    if (await resumeInput.count() === 0) {
        emit("resume_skipped", { message: "No resume file input found" });
        return false;
    }

    const uploadButton = root.getByRole("button", { name: /upload|attach|choose file|select file/i }).first();
    if (await uploadButton.isVisible().catch(() => false)) {
        await uploadButton.click().catch(() => {});
        await root.waitForTimeout(300);
    }

    await resumeInput.setInputFiles(resumePath);
    await root.waitForTimeout(1500);

    const uploadedName = await root.locator("text=/\\.pdf$/i").first().isVisible().catch(() => false);
    emit("resume_uploaded", { uploadedNameVisible: uploadedName });
    return true;
}

async function findManualReviewFields(root) {
    const invalidFields = root.locator("input:invalid, select:invalid, textarea:invalid");
    const count = await invalidFields.count();
    const labels = [];

    for (let index = 0; index < count; index += 1) {
        const field = invalidFields.nth(index);
        const type = (await field.getAttribute("type") || "").toLowerCase();
        if (type === "file" || type === "radio" || type === "hidden") {
            continue;
        }

        if (!await field.isVisible().catch(() => false)) {
            continue;
        }

        const label = normalizeQuestion(pickAshbyQuestionLabel(await getAshbyFieldLabel(field)));
        if (label && !labels.includes(label)) {
            labels.push(label);
        }
    }

    return labels;
}

async function prepareAshbyApplication(page, profile, emit, applicationContext = {}) {
    await dismissCookieBanner(page, emit);
    await waitForAshbyForm(page);

    const companyName = await detectCompanyName(page, applicationContext);
    const targetCountry = await detectTargetCountry(page, applicationContext);
    const fillContext = {
        targetCountry,
        companyName,
        jobLocation: applicationContext.jobLocation || null,
        jobUrl: applicationContext.jobUrl || page.url()
    };

    emit("target_country_detected", { targetCountry, source: applicationContext.targetCountry ? "job_metadata" : "page_text" });
    emit("company_detected", { companyName });

    await fillAshbyLocationCombobox(page, profile, emit);
    const radioResult = await fillAshbyRadioGroups(page, profile, emit, fillContext);
    const fieldResult = await fillKnownFields(page, profile, emit, fillContext);
    const resumeUploaded = await uploadResume(page, profile, emit);
    const manualReviewRequired = await findManualReviewFields(page);

    const unanswered = [...new Set([
        ...radioResult.unanswered,
        ...fieldResult.unanswered
    ])];

    return {
        provider: "ashby",
        companyName,
        targetCountry,
        filled: radioResult.filled + fieldResult.filled,
        unanswered,
        resumeUploaded,
        manualReviewRequired
    };
}

module.exports = {
    detectCompanyName,
    detectTargetCountry,
    findManualReviewFields,
    getAshbyFieldLabel,
    prepareAshbyApplication
};
