const path = require("path");
const { extractCountryFromText } = require("./authorization-policy");
const { formatCompanyName, getAnswer, normalizeQuestion } = require("./answer-engine");
const { escapeRegExp, fillField, selectOption } = require("./greenhouse-helper");

const FIELD_SELECTOR = [
    "textarea",
    "input:not([type='hidden']):not([type='submit']):not([type='button']):not([id^='security-input']):not([role='combobox'])",
    "[role='combobox']"
].join(",");

async function findApplicationRoot(page) {
    const greenhouseFrame = page.frames().find((frame) => /job_app/i.test(frame.url()));

    if (greenhouseFrame) {
        return greenhouseFrame;
    }

    const pageHasForm = await page.locator('form input[type="file"], form #first_name').count() > 0;
    if (pageHasForm) {
        return page;
    }

    throw new Error("No supported application form was found");
}

async function activateApplication(page, emit) {
    if (page.frames().some((frame) => /job_app/i.test(frame.url()))) {
        return;
    }

    const applicationTab = page.getByRole("tab", { name: /application/i }).first();
    const applyButton = page.getByRole("button", { name: /apply now/i }).first();

    if (await applicationTab.count() > 0 && await applicationTab.isVisible().catch(() => false)) {
        await applicationTab.click();
        emit("application_opened", { method: "tab" });
    } else if (await applyButton.count() > 0 && await applyButton.isVisible().catch(() => false)) {
        await applyButton.click();
        emit("application_opened", { method: "button" });
    }

    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        if (page.frames().some((frame) => /job_app/i.test(frame.url()))) {
            return;
        }
        await page.waitForTimeout(250);
    }
}

async function getFieldLabel(field) {
    return field.evaluate((element) => {
        const parts = [];
        const id = element.id;

        if (id) {
            const explicit = element.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
            if (explicit) parts.push(explicit.innerText);
        }

        const wrappingLabel = element.closest("label");
        if (wrappingLabel) parts.push(wrappingLabel.innerText);

        const group = element.closest("fieldset, .field, .application-question, [data-field]");
        if (group) {
            const heading = group.querySelector("legend, label, .label, .field-label");
            if (heading) parts.push(heading.innerText);
        }

        parts.push(
            element.getAttribute("aria-label"),
            element.getAttribute("placeholder"),
            element.name,
            element.id
        );

        return parts.filter(Boolean).join(" ");
    });
}

async function fillKnownFields(root, profile, emit, context = {}) {
    const fields = root.locator(FIELD_SELECTOR);
    const count = await fields.count();
    const handledNames = new Set();
    const unanswered = [];
    let filled = 0;

    for (let index = 0; index < count; index += 1) {
        const field = fields.nth(index);
        if (!await field.isVisible().catch(() => false) || !await field.isEnabled().catch(() => false)) {
            continue;
        }

        const type = (await field.getAttribute("type") || "").toLowerCase();
        if (type === "file") {
            continue;
        }

        const name = await field.getAttribute("name") || await field.getAttribute("id") || `field-${index}`;
        if (name.startsWith("security-input") || /verification code|security code/i.test(name)) {
            continue;
        }
        if (handledNames.has(name) && type === "radio") {
            continue;
        }

        const label = normalizeQuestion(await getFieldLabel(field));
        if (/verification code|security code|confirm you're a human/i.test(label)) {
            continue;
        }
        const answer = getAnswer(label, profile, context);
        handledNames.add(name);

        if (!answer) {
            if (label && !unanswered.includes(label)) {
                unanswered.push(label);
            }
            continue;
        }

        let fillAnswer = answer;
        if (/^school\b/i.test(label) || /^school--/i.test(name)) {
            fillAnswer = "Other";
        }

        try {
            const role = (await field.getAttribute("role") || "").toLowerCase();
            if (role === "combobox") {
                await selectOption(field, fillAnswer, root);
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

    const fileInput = root.locator('input[type="file"]').first();
    if (await fileInput.count() === 0) {
        emit("resume_skipped", { message: "No file input found" });
        return false;
    }

    await fileInput.setInputFiles(path.resolve(profile.resume));
    await root.waitForTimeout(500);
    emit("resume_uploaded", {});
    return true;
}

async function findManualReviewFields(root) {
    const invalidFields = root.locator("input:invalid, select:invalid, textarea:invalid");
    const count = await invalidFields.count();
    const labels = [];

    for (let index = 0; index < count; index += 1) {
        const field = invalidFields.nth(index);
        if (!await field.isVisible().catch(() => false)) continue;

        const label = normalizeQuestion(await getFieldLabel(field));
        if (label && !labels.includes(label)) {
            labels.push(label);
        }
    }

    return labels;
}

async function detectCompanyName(page) {
    const title = await page.title().catch(() => "");
    const titleMatch = title.match(/\bat\s+(.+?)\s*$/i);
    if (titleMatch) {
        return titleMatch[1].trim();
    }

    try {
        const { hostname, pathname } = new URL(page.url());
        const segments = pathname.split("/").filter(Boolean);
        if (/greenhouse\.io$/i.test(hostname) && segments.length > 0) {
            return formatCompanyName(segments[0]);
        }
    } catch {
        return null;
    }

    return null;
}

async function detectTargetCountry(page, root) {
    const text = [
        await page.locator("body").innerText().catch(() => ""),
        await root.locator("body").innerText().catch(() => "")
    ].join(" ");

    return extractCountryFromText(text);
}

async function findEducationSelect(root, fieldName) {
    const selectors = [
        `select#${fieldName}--0`,
        `select[id^="${fieldName}"]`,
        `select[name*="${fieldName}"]`
    ];

    for (const selector of selectors) {
        const field = root.locator(selector).first();
        if (await field.count() > 0) {
            return field;
        }
    }

    return null;
}

async function fillEducationFields(root, profile, emit) {
    await root.locator("select[id^='school'], .education--form").first()
        .waitFor({ state: "attached", timeout: 20000 })
        .catch(() => {});
    await root.locator(".education--form, select[id^='school']").first().scrollIntoViewIfNeeded().catch(() => {});
    await root.waitForTimeout(1000);

    const candidates = [
        { field: "school", label: "School", value: profile.university, fallback: "Other" },
        { field: "degree", label: "Degree", value: profile.highestDegree || "Bachelor's Degree", fallback: null },
        { field: "discipline", label: "Discipline", value: profile.fieldOfStudy, fallback: null }
    ];

    for (const candidate of candidates) {
        if (!candidate.value) continue;

        let field = await findEducationSelect(root, candidate.field);
        if (!field) {
            const row = root.locator(".education--form .field, .education--form .application-question")
                .filter({ hasText: new RegExp(`^${candidate.label}`, "i") })
                .first();
            field = row.locator("select, button, [role='combobox']").first();
            if (await field.count() === 0) {
                emit("field_failed", { field: candidate.field, message: "Education field not found" });
                continue;
            }
        }

        try {
            await selectOption(field, candidate.value, root, candidate.fallback);
            emit("field_filled", { field: candidate.field });
        } catch (error) {
            if (candidate.fallback) {
                try {
                    await selectOption(field, candidate.fallback, root);
                    emit("field_filled", { field: candidate.field, usedFallback: true });
                } catch (fallbackError) {
                    emit("field_failed", { field: candidate.field, message: fallbackError.message });
                }
            } else {
                emit("field_failed", { field: candidate.field, message: error.message });
            }
        }
    }
}

async function fillLocationCombobox(root, profile, emit) {
    if (profile.country) {
        const countryField = root.locator("select#country, #country").first();
        if (await countryField.count() > 0) {
            try {
                await selectOption(countryField, profile.country, root);
                emit("field_filled", { field: "country" });
            } catch (error) {
                emit("field_failed", { field: "country", message: error.message });
            }
        }
    }

    if (!profile.city) {
        return;
    }

    const cityField = root.locator("#candidate-location, input[name='candidate-location']").first();
    if (await cityField.count() === 0 || !await cityField.isVisible().catch(() => false)) {
        return;
    }

    try {
        await cityField.scrollIntoViewIfNeeded().catch(() => {});
        await cityField.click();
        await cityField.fill(profile.city);
        await root.waitForTimeout(600);

        const cityOption = root.getByRole("option").filter({ hasText: new RegExp(escapeRegExp(profile.city), "i") }).first();
        if (await cityOption.isVisible().catch(() => false)) {
            await cityOption.click();
        } else {
            await cityField.press("Enter");
        }

        emit("field_filled", { field: "city" });
    } catch (error) {
        emit("field_failed", { field: "city", message: error.message });
    }
}

async function prepareGreenhouseApplication(page, profile, emit) {
    await activateApplication(page, emit);
    const root = await findApplicationRoot(page);
    await root.locator(FIELD_SELECTOR).first().waitFor({ state: "visible", timeout: 15000 });
    const targetCountry = await detectTargetCountry(page, root);
    const companyName = await detectCompanyName(page);
    emit("target_country_detected", { targetCountry });
    emit("company_detected", { companyName });
    await fillLocationCombobox(root, profile, emit);
    const result = await fillKnownFields(root, profile, emit, { targetCountry, companyName });
    const resumeUploaded = await uploadResume(root, profile, emit);
    const manualReviewRequired = await findManualReviewFields(root);

    return {
        provider: "greenhouse",
        companyName,
        targetCountry,
        filled: result.filled,
        unanswered: result.unanswered,
        resumeUploaded,
        manualReviewRequired
    };
}

module.exports = {
    activateApplication,
    detectCompanyName,
    detectTargetCountry,
    findApplicationRoot,
    findManualReviewFields,
    getFieldLabel,
    prepareGreenhouseApplication
};
