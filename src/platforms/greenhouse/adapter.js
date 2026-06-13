const path = require("path");
const { extractCountryFromText } = require("../../core/authorization-policy");
const { formatCompanyName, getAnswer, normalizeQuestion } = require("../../core/answer-engine");
const { escapeRegExp, fillField, selectOption } = require("./helper");

const FIELD_SELECTOR = [
    "textarea",
    "input:not([type='hidden']):not([type='submit']):not([type='button']):not([id^='security-input']):not([role='combobox'])",
    "[role='combobox']"
].join(",");

const APPLICATION_FORM_SELECTOR = [
    "form #first_name",
    "#first_name",
    'input[name="first_name"]',
    "form input[type='file']",
    "#application-form"
].join(", ");

async function pageHasApplicationForm(page) {
    return page.locator(APPLICATION_FORM_SELECTOR).count().then((count) => count > 0);
}

async function findApplicationRoot(page) {
    const greenhouseFrame = page.frames().find((frame) => /job_app/i.test(frame.url()));

    if (greenhouseFrame) {
        return greenhouseFrame;
    }

    if (await pageHasApplicationForm(page)) {
        return page;
    }

    throw new Error("No supported application form was found");
}

async function activateApplication(page, emit) {
    if (page.frames().some((frame) => /job_app/i.test(frame.url()))) {
        return;
    }

    if (await pageHasApplicationForm(page)) {
        emit("application_opened", { method: "inline-form" });
        return;
    }

    const acceptButton = page.getByRole("button", { name: /accept all|agree and proceed|i agree|got it|allow all/i }).first();
    if (await acceptButton.isVisible().catch(() => false)) {
        await acceptButton.click().catch(() => {});
        await page.waitForTimeout(500);
        emit("cookie_banner_dismissed", {});
    }

    const applicationTab = page.getByRole("tab", { name: /application/i }).first();
    const applyButton = page.getByRole("button", { name: /apply now|apply for this job|apply$/i }).first();
    const applyLink = page.getByRole("link", { name: /apply now|apply for this job|apply$/i }).first();

    if (await applicationTab.count() > 0 && await applicationTab.isVisible().catch(() => false)) {
        await applicationTab.click();
        emit("application_opened", { method: "tab" });
    } else if (await applyButton.count() > 0 && await applyButton.isVisible().catch(() => false)) {
        await applyButton.click();
        emit("application_opened", { method: "button" });
    } else if (await applyLink.count() > 0 && await applyLink.isVisible().catch(() => false)) {
        await applyLink.click();
        emit("application_opened", { method: "link" });
    }

    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
        if (page.frames().some((frame) => /job_app/i.test(frame.url()))) {
            return;
        }

        if (await pageHasApplicationForm(page)) {
            emit("application_opened", { method: "inline-form" });
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

        const hostCompany = hostname.split(".")[0].replace(/^www$/i, "");
        if (hostCompany && !/greenhouse|myworkdayjobs/i.test(hostCompany)) {
            return formatCompanyName(hostCompany);
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

async function findWorkHistoryField(root, fieldName, index) {
    const suffix = `--${index}`;
    const selectors = [
        `#${fieldName}${suffix}`,
        `[id="${fieldName}${suffix}"]`,
        `input[name="${fieldName}${suffix}"]`,
        `select[id^="${fieldName}"]`
    ];

    for (const selector of selectors) {
        const field = root.locator(selector).first();
        if (await field.count() > 0) {
            return field;
        }
    }

    return null;
}

async function fillWorkHistory(root, profile, emit) {
    const history = profile.workHistory || [];
    if (!history.length) {
        return;
    }

    await root.locator(".experience--form, input[id^='company-name'], #company-name--0")
        .first()
        .waitFor({ state: "attached", timeout: 10000 })
        .catch(() => {});

    for (let index = 0; index < history.length; index += 1) {
        const job = history[index];
        const entries = [
            { field: "company-name", value: job.company },
            { field: "title", value: job.title },
            { field: "start-month", value: job.startMonth },
            { field: "start-year", value: job.startYear },
            { field: "end-month", value: job.current ? "I currently work here" : job.endMonth },
            { field: "end-year", value: job.current ? "" : job.endYear }
        ];

        for (const entry of entries) {
            if (!entry.value) {
                continue;
            }

            const field = await findWorkHistoryField(root, entry.field, index);
            if (!field) {
                continue;
            }

            try {
                const role = (await field.getAttribute("role") || "").toLowerCase();
                if (role === "combobox" || (await field.evaluate((el) => el.tagName.toLowerCase())) === "select") {
                    await selectOption(field, entry.value, root);
                } else {
                    await fillField(field, entry.value, root);
                }
                emit("field_filled", { field: `${entry.field}--${index}` });
            } catch (error) {
                emit("field_failed", { field: `${entry.field}--${index}`, message: error.message });
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

async function prepareGreenhouseApplication(page, profile, emit, applicationContext = {}) {
    await activateApplication(page, emit);
    const root = await findApplicationRoot(page);
    await root.locator(FIELD_SELECTOR).first().waitFor({ state: "visible", timeout: 15000 });

    const pageCountry = await detectTargetCountry(page, root);
    const pageCompany = await detectCompanyName(page);
    const targetCountry = applicationContext.targetCountry || pageCountry;
    const companyName = applicationContext.companyName || pageCompany;
    const fillContext = {
        targetCountry,
        companyName,
        jobLocation: applicationContext.jobLocation || null,
        jobUrl: applicationContext.jobUrl || page.url()
    };

    emit("target_country_detected", { targetCountry, source: applicationContext.targetCountry ? "job_metadata" : "page_text" });
    emit("company_detected", { companyName });
    await fillLocationCombobox(root, profile, emit);
    await fillWorkHistory(root, profile, emit);
    const result = await fillKnownFields(root, profile, emit, fillContext);
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
