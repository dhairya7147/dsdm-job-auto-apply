const path = require("path");
const { getAnswer, normalizeQuestion } = require("./answer-engine");
const { fillField, selectOption } = require("./greenhouse-helper");

const FIELD_SELECTOR = [
    "input:not([type='hidden']):not([type='submit']):not([type='button'])",
    "textarea",
    "select",
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
        if (handledNames.has(name) && type === "radio") {
            continue;
        }

        const label = normalizeQuestion(await getFieldLabel(field));
        const answer = getAnswer(label, profile, context);
        handledNames.add(name);

        if (!answer) {
            if (label && !unanswered.includes(label)) {
                unanswered.push(label);
            }
            continue;
        }

        try {
            await fillField(field, answer);
            filled += 1;
            emit("field_filled", { field: label || name });
        } catch (error) {
            emit("field_failed", { field: label || name, message: error.message });
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

async function detectTargetCountry(page, root) {
    const text = [
        await page.locator("body").innerText().catch(() => ""),
        await root.locator("body").innerText().catch(() => "")
    ].join(" ");
    const knownCountries = [
        "India",
        "United Kingdom",
        "United States",
        "Canada",
        "Australia",
        "Germany",
        "France",
        "Ireland",
        "Netherlands",
        "Singapore"
    ];

    return knownCountries.find((country) =>
        new RegExp(`\\b${country.replace(/\s+/g, "\\s+")}\\b`, "i").test(text)
    ) || null;
}

async function fillLocationCombobox(root, profile, emit) {
    const candidates = [
        { selector: "#country", value: profile.country, field: "country" },
        { selector: "#candidate-location", value: profile.city, field: "city" }
    ];

    for (const candidate of candidates) {
        if (!candidate.value) continue;
        const field = root.locator(candidate.selector).first();
        if (await field.count() === 0 || !await field.isVisible().catch(() => false)) continue;

        try {
            await selectOption(field, candidate.value);
            emit("field_filled", { field: candidate.field });
        } catch (error) {
            emit("field_failed", { field: candidate.field, message: error.message });
        }
    }
}

async function prepareGreenhouseApplication(page, profile, emit) {
    await activateApplication(page, emit);
    const root = await findApplicationRoot(page);
    await root.locator(FIELD_SELECTOR).first().waitFor({ state: "visible", timeout: 15000 });
    const targetCountry = await detectTargetCountry(page, root);
    emit("target_country_detected", { targetCountry });
    await fillLocationCombobox(root, profile, emit);
    const result = await fillKnownFields(root, profile, emit, { targetCountry });
    const resumeUploaded = await uploadResume(root, profile, emit);
    const manualReviewRequired = await findManualReviewFields(root);

    return {
        provider: "greenhouse",
        targetCountry,
        filled: result.filled,
        unanswered: result.unanswered,
        resumeUploaded,
        manualReviewRequired
    };
}

module.exports = {
    activateApplication,
    detectTargetCountry,
    findApplicationRoot,
    findManualReviewFields,
    getFieldLabel,
    prepareGreenhouseApplication
};
