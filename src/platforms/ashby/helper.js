const { optionMatches } = require("../greenhouse/helper");

async function getAshbyFieldLabel(field) {
    return field.evaluate((element) => {
        const parts = [];
        const id = element.id;

        if (id) {
            const explicit = element.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
            if (explicit) {
                parts.push(explicit.innerText);
            }
        }

        const wrappingLabel = element.closest("label");
        if (wrappingLabel) {
            parts.push(wrappingLabel.innerText);
        }

        let node = element.parentElement;
        for (let depth = 0; depth < 8 && node; depth += 1) {
            const heading = node.querySelector(":scope > label, :scope > h3, :scope > h4, :scope > p, :scope > span");
            if (heading?.innerText?.trim()) {
                parts.push(heading.innerText);
            }
            node = node.parentElement;
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

function pickAshbyQuestionLabel(rawLabel, optionTexts = []) {
    const parts = String(rawLabel || "")
        .split("|")
        .map((part) => part.trim())
        .filter(Boolean);

    if (parts.length === 0) {
        return "";
    }

    const normalizedOptions = new Set(optionTexts.map((text) => text.trim().toLowerCase()));
    const isOptionLike = (part) => normalizedOptions.has(part.toLowerCase());

    const questionLike = parts.find((part) =>
        !isOptionLike(part)
        && (/please confirm|are you|do you|will you|would you|have you|\?/i.test(part) || part.length >= 48)
    );
    if (questionLike) {
        return questionLike;
    }

    const nonOption = parts.filter((part) => !isOptionLike(part));
    const pool = nonOption.length > 0 ? nonOption : parts;
    return pool.sort((left, right) => right.length - left.length)[0];
}

async function getAshbyRadioGroupQuestion(root, groupName) {
    const radios = root.locator(`input[type="radio"][name="${groupName}"]`);
    const optionTexts = [];
    const count = await radios.count();

    for (let index = 0; index < count; index += 1) {
        const radio = radios.nth(index);
        const id = await radio.getAttribute("id");
        if (!id) {
            continue;
        }

        const text = (await root.locator(`label[for="${id}"]`).first().innerText().catch(() => "")).trim();
        if (text) {
            optionTexts.push(text);
        }
    }

    if (count === 0) {
        return { questionLabel: "", optionTexts };
    }

    const rawLabel = await getAshbyFieldLabel(radios.first());
    return {
        questionLabel: pickAshbyQuestionLabel(rawLabel, optionTexts),
        optionTexts
    };
}

function resolveAshbySystemFieldAnswer(systemFieldName, label, profile) {
    if (systemFieldName === "_systemfield_email") {
        return profile.email || null;
    }

    if (systemFieldName === "_systemfield_name") {
        if (/preferred name/i.test(label)) {
            return profile.preferredName || profile.firstName || null;
        }

        if (/full name|legal name/i.test(label)) {
            return profile.fullName || null;
        }

        if (/first name/i.test(label)) {
            return profile.firstName || null;
        }

        if (/last name/i.test(label)) {
            return profile.lastName || null;
        }

        return profile.fullName || profile.preferredName || profile.firstName || null;
    }

    return null;
}

async function selectAshbyRadioGroup(root, groupName, questionLabel, value) {
    const radios = root.locator(`input[type="radio"][name="${groupName}"]`);
    const count = await radios.count();
    if (count === 0) {
        throw new Error(`No radio group found for ${groupName}`);
    }

    for (let index = 0; index < count; index += 1) {
        const radio = radios.nth(index);
        const id = await radio.getAttribute("id");
        if (!id) {
            continue;
        }

        const label = root.locator(`label[for="${id}"]`).first();
        const text = (await label.innerText().catch(() => "")).trim();
        if (!text) {
            continue;
        }

        if (optionMatches(text, value)) {
            await label.click();
            return text;
        }
    }

    if (/^yes$/i.test(String(value)) && /in[- ]?person|office|hybrid/i.test(questionLabel)) {
        for (let index = 0; index < count; index += 1) {
            const radio = radios.nth(index);
            const id = await radio.getAttribute("id");
            const label = root.locator(`label[for="${id}"]`).first();
            const text = (await label.innerText().catch(() => "")).trim();
            if (/able to be in[- ]?person|i am able|yes/i.test(text) && !/not able|unable/i.test(text)) {
                await label.click();
                return text;
            }
        }
    }

    throw new Error(`No radio option matching "${value}" for "${questionLabel}"`);
}

async function fillAshbyLocationCombobox(root, profile, emit) {
    let field = root.locator("input[role='combobox']").first();
    const labeled = root.locator("label", { hasText: /^location$/i }).first();
    if (await labeled.count() > 0) {
        const forId = await labeled.getAttribute("for");
        if (forId) {
            const byFor = root.locator(`#${forId.replace(/:/g, "\\:")}`);
            if (await byFor.count() > 0) {
                field = byFor;
            }
        }
    }
    if (await field.count() === 0 || !await field.isVisible().catch(() => false)) {
        return false;
    }

    const city = profile.city || profile.currentLocation || "Gurgaon";
    const { selectOption } = require("../greenhouse/helper");

    try {
        await selectOption(field, city, root, profile.country || "India");
        emit("field_filled", { field: "location" });
        return true;
    } catch (error) {
        try {
            await field.click();
            await field.fill(city);
            await root.waitForTimeout(400);
            const option = root.getByRole("option").filter({ hasText: new RegExp(city, "i") }).first();
            if (await option.isVisible().catch(() => false)) {
                await option.click();
            } else {
                await field.press("Enter");
            }
            emit("field_filled", { field: "location", method: "type_enter" });
            return true;
        } catch (innerError) {
            emit("field_failed", { field: "location", message: innerError.message });
            return false;
        }
    }
}

module.exports = {
    fillAshbyLocationCombobox,
    getAshbyFieldLabel,
    getAshbyRadioGroupQuestion,
    pickAshbyQuestionLabel,
    resolveAshbySystemFieldAnswer,
    selectAshbyRadioGroup
};
