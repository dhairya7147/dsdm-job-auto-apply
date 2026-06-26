const { getAnswer, normalizeQuestion } = require("../../core/answer-engine");
const { escapeRegExp, fillField, optionMatches } = require("../greenhouse/helper");

function pickLeverQuestionLabel(label) {
    return normalizeQuestion(String(label || "")
        .replace(/[✱*]+/g, "")
        .replace(/\s+/g, " ")
        .trim());
}

async function getLeverQuestionLabel(element) {
    const question = element.locator("xpath=ancestor::li[contains(@class,'application-question')][1]");
    if (await question.count() > 0) {
        const label = await question.locator(".application-label").first().innerText().catch(() => "");
        if (label) {
            return pickLeverQuestionLabel(label);
        }
    }

    const aria = await element.getAttribute("aria-label");
    if (aria) {
        return pickLeverQuestionLabel(aria);
    }

    const fieldId = await element.getAttribute("id");
    if (fieldId) {
        const page = element.page();
        const linked = page.locator(`label[for="${fieldId}"]`).first();
        if (await linked.count() > 0) {
            return pickLeverQuestionLabel(await linked.innerText());
        }
    }

    const name = await element.getAttribute("name");
    return pickLeverQuestionLabel(name || "");
}

function resolveLeverSystemFieldAnswer(fieldName, label, profile) {
    const normalizedName = String(fieldName || "").toLowerCase();
    const normalizedLabel = String(label || "").toLowerCase();

    if (normalizedName === "name" || /full name|legal name/i.test(normalizedLabel)) {
        return profile.fullName || null;
    }
    if (normalizedName === "email") {
        return profile.email || null;
    }
    if (normalizedName === "phone") {
        return profile.phone || null;
    }
    if (normalizedName === "location" || /current location/i.test(normalizedLabel)) {
        return profile.city || profile.location || null;
    }
    if (normalizedName === "org" || /current company/i.test(normalizedLabel)) {
        return profile.currentEmployer || null;
    }
    if (/linkedin/i.test(normalizedName) || /linkedin/i.test(normalizedLabel)) {
        return profile.linkedin || null;
    }
    if (/github/i.test(normalizedName) || /github/i.test(normalizedLabel)) {
        return profile.github || null;
    }
    if (/portfolio/i.test(normalizedName) || /portfolio/i.test(normalizedLabel)) {
        return profile.portfolio || null;
    }
    if (/website/i.test(normalizedName) || /other website/i.test(normalizedLabel)) {
        return profile.website || profile.portfolio || null;
    }

    return null;
}

async function fillLeverLocation(root, profile, emit) {
    const locationInput = root.locator("#location-input, input.location-input[name='location']").first();
    if (await locationInput.count() === 0 || !await locationInput.isVisible().catch(() => false)) {
        return false;
    }

    const value = profile.city || profile.location;
    if (!value) {
        return false;
    }

    await locationInput.scrollIntoViewIfNeeded().catch(() => {});
    await locationInput.click();
    await locationInput.fill("");
    await locationInput.pressSequentially(String(value), { delay: 80 });

    let results = root.locator(".dropdown-results > div");
    let resultCount = 0;
    for (let attempt = 0; attempt < 10; attempt += 1) {
        await root.waitForTimeout(400);
        resultCount = await results.count();
        if (resultCount > 0) {
            break;
        }
    }

    if (resultCount === 0) {
        const apiMatches = await root.evaluate(async (searchText) => {
            const response = await fetch(`/searchLocations?text=${encodeURIComponent(searchText)}&hcaptchaResponse=`);
            if (!response.ok) {
                return [];
            }

            return response.json();
        }, String(value)).catch(() => []);

        if (apiMatches.length > 0) {
            const preferred = apiMatches.find((entry) => /gurugram|gurgaon/i.test(entry.name))
                || apiMatches[0];
            await root.evaluate(({ id, name }) => {
                const input = document.querySelector("#location-input, input.location-input[name='location']");
                const hidden = document.querySelector("#selected-location, input[name='selectedLocation']");
                if (input) {
                    input.value = name;
                    input.dispatchEvent(new Event("input", { bubbles: true }));
                    input.dispatchEvent(new Event("change", { bubbles: true }));
                }
                if (hidden) {
                    hidden.value = id;
                    hidden.dispatchEvent(new Event("change", { bubbles: true }));
                }
            }, preferred);
            emit("field_filled", { field: "Current location", value: preferred.name, type: "location" });
            return true;
        }

        emit("field_failed", { field: "Current location", message: "No location suggestions returned", type: "location" });
        return false;
    }

    let selectedText = null;
    for (let index = 0; index < resultCount; index += 1) {
        const option = results.nth(index);
        const text = (await option.innerText().catch(() => "")).trim();
        if (!text) {
            continue;
        }

        if (optionMatches(text, value) || /gurugram|gurgaon/i.test(text)) {
            await option.click({ force: true });
            selectedText = text;
            break;
        }
    }

    if (!selectedText) {
        selectedText = (await results.first().innerText().catch(() => "")).trim();
        await results.first().click({ force: true });
    }

    await root.waitForTimeout(400);

    const selectedLocation = await root.locator("#selected-location, input[name='selectedLocation']").first()
        .inputValue()
        .catch(() => "");

    if (!selectedLocation) {
        emit("field_failed", { field: "Current location", message: "Location suggestion was not committed", type: "location" });
        return false;
    }

    emit("field_filled", { field: "Current location", value: selectedText || value, type: "location" });
    return true;
}

async function selectLeverRadioGroup(root, groupName, questionLabel, value) {
    const radios = root.locator(`input[type="radio"][name="${groupName}"]`);
    const count = await radios.count();
    if (count === 0) {
        throw new Error(`No radio group found for ${groupName}`);
    }

    for (let index = 0; index < count; index += 1) {
        const radio = radios.nth(index);
        if (!await radio.isVisible().catch(() => false)) {
            continue;
        }

        const label = radio.locator("xpath=ancestor::label[1]");
        const text = await label.innerText().catch(async () => {
            const optionValue = await radio.getAttribute("value");
            return optionValue || "";
        });

        if (optionMatches(text, value)) {
            await label.click().catch(async () => radio.check({ force: true }));
            return text.trim();
        }
    }

    throw new Error(`No radio option matching "${value}" for ${questionLabel}`);
}

async function selectLeverCheckboxOption(root, groupName, questionLabel, value) {
    const checkboxes = root.locator(`input[type="checkbox"][name="${groupName}"]`);
    const count = await checkboxes.count();
    if (count === 0) {
        throw new Error(`No checkbox group found for ${groupName}`);
    }

    for (let index = 0; index < count; index += 1) {
        const checkbox = checkboxes.nth(index);
        if (!await checkbox.isVisible().catch(() => false)) {
            continue;
        }

        const label = checkbox.locator("xpath=ancestor::label[1]");
        const text = await label.innerText().catch(async () => {
            const optionValue = await checkbox.getAttribute("value");
            return optionValue || "";
        });

        if (optionMatches(text, value)) {
            await label.click().catch(async () => checkbox.check({ force: true }));
            return text.trim();
        }
    }

    throw new Error(`No checkbox option matching "${value}" for ${questionLabel}`);
}

function shouldSelectLeverCheckbox(optionText, answer) {
    const requested = String(answer || "");
    if (!requested) {
        return false;
    }

    if (/,|\band\b/i.test(requested)) {
        return requested.split(/,|\band\b/i)
            .map((part) => part.trim())
            .filter(Boolean)
            .some((part) => optionMatches(optionText, part));
    }

    return optionMatches(optionText, requested);
}

async function fillLeverRadioGroups(root, profile, emit, context = {}) {
    const groups = await root.locator("input[type='radio']").evaluateAll((elements) => {
        const names = new Set();
        for (const element of elements) {
            if (element.name && element.offsetParent !== null) {
                names.add(element.name);
            }
        }
        return [...names];
    });

    let filled = 0;
    const unanswered = [];

    for (const groupName of groups) {
        const sample = root.locator(`input[type="radio"][name="${groupName}"]`).first();
        const questionLabel = await getLeverQuestionLabel(sample);
        if (!questionLabel) {
            continue;
        }

        const answer = getAnswer(questionLabel, profile, context);
        if (!answer) {
            if (!unanswered.includes(questionLabel)) {
                unanswered.push(questionLabel);
            }
            continue;
        }

        try {
            const selected = await selectLeverRadioGroup(root, groupName, questionLabel, answer);
            filled += 1;
            emit("field_filled", { field: questionLabel, value: selected, type: "radio" });
        } catch (error) {
            emit("field_failed", { field: questionLabel, message: error.message, type: "radio" });
            if (!unanswered.includes(questionLabel)) {
                unanswered.push(questionLabel);
            }
        }
    }

    return { filled, unanswered };
}

async function fillLeverCheckboxGroups(root, profile, emit, context = {}) {
    const groups = await root.locator("input[type='checkbox']").evaluateAll((elements) => {
        const grouped = new Map();
        for (const element of elements) {
            if (!element.name || element.offsetParent === null) {
                continue;
            }

            const entry = grouped.get(element.name) || { count: 0, question: "" };
            entry.count += 1;
            const questionNode = element.closest("li.application-question");
            if (questionNode) {
                const label = questionNode.querySelector(".application-label");
                entry.question = label?.innerText?.trim() || entry.question;
            }
            grouped.set(element.name, entry);
        }

        return [...grouped.entries()].map(([name, meta]) => ({
            name,
            count: meta.count,
            question: meta.question
        }));
    });

    let filled = 0;
    const unanswered = [];

    for (const group of groups) {
        const questionLabel = pickLeverQuestionLabel(group.question) || group.name;
        const answer = getAnswer(questionLabel, profile, context);
        if (!answer) {
            if (group.count > 1 && !unanswered.includes(questionLabel)) {
                unanswered.push(questionLabel);
            }
            continue;
        }

        try {
            if (group.count === 1) {
                const checkbox = root.locator(`input[type="checkbox"][name="${group.name}"]`).first();
                const shouldCheck = shouldSelectLeverCheckbox(await checkbox.getAttribute("value") || questionLabel, answer);
                await checkbox.setChecked(shouldCheck);
                filled += 1;
                emit("field_filled", { field: questionLabel, value: shouldCheck ? "checked" : "unchecked", type: "checkbox" });
                continue;
            }

            const selected = await selectLeverCheckboxOption(root, group.name, questionLabel, answer);
            filled += 1;
            emit("field_filled", { field: questionLabel, value: selected, type: "checkbox" });
        } catch (error) {
            emit("field_failed", { field: questionLabel, message: error.message, type: "checkbox" });
            if (!unanswered.includes(questionLabel)) {
                unanswered.push(questionLabel);
            }
        }
    }

    return { filled, unanswered };
}

async function fillLeverKnownFields(root, profile, emit, context = {}) {
    const fields = root.locator([
        "textarea",
        "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='file']):not([type='radio']):not([type='checkbox'])",
        "select"
    ].join(","));
    const count = await fields.count();
    const handledKeys = new Set();
    const unanswered = [];
    let filled = 0;

    for (let index = 0; index < count; index += 1) {
        const field = fields.nth(index);
        if (!await field.isVisible().catch(() => false) || !await field.isEnabled().catch(() => false)) {
            continue;
        }

        const name = await field.getAttribute("name") || "";
        const fieldId = await field.getAttribute("id") || "";
        if (name === "location" || fieldId === "location-input") {
            continue;
        }

        const label = await getLeverQuestionLabel(field);
        const dedupeKey = `${name}::${label}`;
        if (handledKeys.has(dedupeKey)) {
            continue;
        }
        handledKeys.add(dedupeKey);

        const systemAnswer = resolveLeverSystemFieldAnswer(name, label, profile);
        const answer = systemAnswer || getAnswer(label, profile, context);
        if (!answer) {
            if (label && !unanswered.includes(label)) {
                unanswered.push(label);
            }
            continue;
        }

        try {
            const tagName = await field.evaluate((element) => element.tagName.toLowerCase());
            if (tagName === "select") {
                await fillField(field, answer, root);
            } else {
                await fillField(field, answer, root);
            }
            filled += 1;
            emit("field_filled", { field: label || name, value: answer });
        } catch (error) {
            emit("field_failed", { field: label || name, message: error.message });
            if (label && !unanswered.includes(label)) {
                unanswered.push(label);
            }
        }
    }

    return { filled, unanswered };
}

async function findManualReviewFields(root) {
    const invalidFields = root.locator("input:invalid, select:invalid, textarea:invalid");
    const count = await invalidFields.count();
    const labels = [];

    for (let index = 0; index < count; index += 1) {
        const field = invalidFields.nth(index);
        const type = (await field.getAttribute("type") || "").toLowerCase();
        if (type === "file" || type === "radio" || type === "hidden" || type === "checkbox") {
            continue;
        }

        if (!await field.isVisible().catch(() => false)) {
            continue;
        }

        const label = pickLeverQuestionLabel(await getLeverQuestionLabel(field));
        if (label && !labels.includes(label)) {
            labels.push(label);
        }
    }

    return labels;
}

module.exports = {
    fillLeverCheckboxGroups,
    fillLeverKnownFields,
    fillLeverLocation,
    fillLeverRadioGroups,
    findManualReviewFields,
    getLeverQuestionLabel,
    pickLeverQuestionLabel,
    resolveLeverSystemFieldAnswer,
    selectLeverCheckboxOption,
    selectLeverRadioGroup,
    shouldSelectLeverCheckbox
};
