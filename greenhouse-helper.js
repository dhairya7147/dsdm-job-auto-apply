function normalize(value) {
    return String(value || "").trim().toLowerCase();
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function optionMatches(option, value) {
    const candidate = normalize(option);
    const requested = normalize(value);

    if (candidate === requested || candidate.includes(requested) || requested.includes(candidate)) {
        return true;
    }

    if (requested === "asian") {
        return candidate.startsWith("asian") || candidate.includes("asian (");
    }
    if (requested === "south asian") {
        return candidate.includes("south asian");
    }
    if (requested === "bachelor's" || requested === "bachelors" || requested === "bachelor's degree") {
        return candidate.includes("bachelor");
    }
    if (requested === "female" || requested === "woman") {
        return candidate === "woman" || candidate === "female" || candidate.includes("woman");
    }
    if (requested === "computer science") {
        return candidate.includes("computer science");
    }
    if (requested === "no") {
        return /^(no\b|i am not\b|not a\b|none\b|i do not\b)/.test(candidate);
    }
    if (requested === "yes") {
        return /^(yes\b|i am\b|i have\b)/.test(candidate);
    }

    return false;
}

function findBestOption(options, value) {
    const exact = options.find((option) => normalize(option) === normalize(value));
    if (exact) {
        return exact;
    }

    const partial = options.find((option) => optionMatches(option, value));
    if (partial) {
        return partial;
    }

    const words = normalize(value).split(/\s+/).filter((word) => word.length > 3);
    return options.find((option) => {
        const candidate = normalize(option);
        return words.some((word) => candidate.includes(word));
    }) || null;
}

function findStrictOption(options, value) {
    const requested = normalize(value);

    const exact = options.find((option) => normalize(option) === requested);
    if (exact) {
        return exact;
    }

    return options.find((option) => {
        const candidate = normalize(option);
        return candidate.includes(requested) || requested.includes(candidate);
    }) || null;
}

function resolveOptionMatch(labels, value, fallback = null, strict = false) {
    const match = strict ? findStrictOption(labels, value) : findBestOption(labels, value);
    if (match) {
        return match;
    }

    if (fallback) {
        return findBestOption(labels, fallback);
    }

    return null;
}

async function dispatchFieldEvents(field) {
    await field.evaluate((element) => {
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new Event("blur", { bubbles: true }));
    });
}

async function getFlyoutToggle(field) {
    const row = field.locator("xpath=ancestor::*[contains(@class,'field') or contains(@class,'question')][1]");
    const toggle = row.locator("button").filter({ hasText: "Toggle flyout" }).first();
    if (await toggle.count() > 0) {
        return toggle;
    }

    return field.locator("xpath=following-sibling::button[1]");
}

async function getFieldListbox(field) {
    const row = field.locator("xpath=ancestor::*[contains(@class,'field') or contains(@class,'question')][1]");
    const scoped = row.locator("[role='listbox']").first();
    if (await scoped.count() > 0) {
        return scoped;
    }

    return field.page().locator("[role='listbox']").last();
}

async function clickOption(field, value, fallback = null, strict = false) {
    const listbox = await getFieldListbox(field);
    const options = await listbox.getByRole("option").allTextContents();
    const match = resolveOptionMatch(options, value, fallback, strict);

    if (!match) {
        return false;
    }

    await listbox.getByRole("option", { name: match, exact: true }).click();
    return true;
}

async function commitComboboxValue(field, value) {
    const current = (await field.inputValue().catch(() => "")).trim();
    if (!current || !optionMatches(current, value)) {
        return false;
    }

    await field.press("Enter");
    await dispatchFieldEvents(field);
    return true;
}

async function selectGreenhouseFlyout(root, field, value, fallback = null, strict = false) {
    await field.scrollIntoViewIfNeeded().catch(() => {});
    await root.keyboard.press("Escape").catch(() => {});
    await root.waitForTimeout(150);

    const fieldId = await field.getAttribute("id") || "";
    const fieldName = [
        await field.getAttribute("aria-label"),
        await field.getAttribute("name"),
        fieldId
    ].filter(Boolean).join(" ");
    const isSchool = /^school--/i.test(fieldId) || /\bschool\b/i.test(fieldName);
    const searchable = isSchool || /discipline/i.test(fieldName);
    const targetValue = isSchool ? "Other" : value;
    const targetFallback = isSchool ? null : fallback;

    if (searchable) {
        await field.click();
        await field.fill(String(targetValue));

        for (let attempt = 0; attempt < 6; attempt += 1) {
            await root.waitForTimeout(400);
            if (await commitComboboxValue(field, targetValue)) {
                await root.keyboard.press("Escape").catch(() => {});
                return;
            }
        }

        if (isSchool) {
            await field.press("Enter");
            await dispatchFieldEvents(field);
            await root.keyboard.press("Escape").catch(() => {});
            return;
        }

        if (targetFallback) {
            await field.fill(String(targetFallback));
            for (let attempt = 0; attempt < 6; attempt += 1) {
                await root.waitForTimeout(400);
                if (await commitComboboxValue(field, targetFallback)) {
                    await root.keyboard.press("Escape").catch(() => {});
                    return;
                }
            }
        }

        if (await clickOption(field, targetValue, targetFallback, strict)) {
            await dispatchFieldEvents(field);
            await root.keyboard.press("Escape").catch(() => {});
            return;
        }
    }

    const toggle = await getFlyoutToggle(field);
    if (await toggle.count() > 0) {
        await toggle.click();
    } else {
        await field.click();
    }

    await root.waitForTimeout(300);

    if (await clickOption(field, value, fallback, strict)) {
        await dispatchFieldEvents(field);
        await root.keyboard.press("Escape").catch(() => {});
        return;
    }

    if (fallback && await clickOption(field, fallback, null, strict)) {
        await dispatchFieldEvents(field);
        await root.keyboard.press("Escape").catch(() => {});
        return;
    }

    throw new Error(`No option matching "${value}"`);
}

async function selectNativeOption(field, value, fallback = null) {
    const options = await field.locator("option").evaluateAll((elements) =>
        elements.map((element) => ({
            label: element.textContent.trim(),
            value: element.getAttribute("value")
        }))
    );

    const labels = options.map((option) => option.label).filter((label) => label && !/^select/i.test(label));
    const match = resolveOptionMatch(labels, value, fallback);

    if (!match) {
        throw new Error(`No option matching "${value}"`);
    }

    const option = options.find((entry) => entry.label === match);
    if (option?.value) {
        await field.selectOption(option.value);
    } else {
        await field.selectOption({ label: match });
    }

    await dispatchFieldEvents(field);
}

async function selectRadio(field, value) {
    const container = field.locator("xpath=ancestor::*[fieldset or @role='radiogroup'][1]");
    const labels = container.locator("label");
    const count = await labels.count();

    for (let index = 0; index < count; index += 1) {
        const label = labels.nth(index);
        const text = await label.innerText();
        if (optionMatches(text, value)) {
            await label.click();
            return;
        }
    }

    throw new Error(`No radio option matching "${value}"`);
}

async function fillField(field, value, root = null) {
    const type = normalize(await field.getAttribute("type"));
    const role = normalize(await field.getAttribute("role"));
    const tagName = await field.evaluate((element) => element.tagName.toLowerCase());
    const scope = root || field.page();

    await field.scrollIntoViewIfNeeded().catch(() => {});

    if (type === "radio") {
        await selectRadio(field, value);
        return;
    }

    if (role === "combobox") {
        await selectGreenhouseFlyout(scope, field, value);
        return;
    }

    if (tagName === "select") {
        await selectNativeOption(field, value);
        return;
    }

    if (type === "checkbox") {
        const affirmative = /^(yes|true|1|agree|accepted)$/i.test(String(value));
        await field.setChecked(affirmative);
        return;
    }

    await field.fill(String(value));
    await dispatchFieldEvents(field);
}

async function selectOption(field, value, root = null, fallback = null, strict = false) {
    const role = normalize(await field.getAttribute("role"));
    const tagName = await field.evaluate((element) => element.tagName.toLowerCase());
    const scope = root || field.page();

    if (role === "combobox") {
        await selectGreenhouseFlyout(scope, field, value, fallback, strict);
        return;
    }

    if (tagName === "select") {
        await selectNativeOption(field, value, fallback);
        return;
    }

    await selectGreenhouseFlyout(scope, field, value, fallback, strict);
}

module.exports = {
    escapeRegExp,
    fillField,
    findBestOption,
    optionMatches,
    resolveOptionMatch,
    selectGreenhouseFlyout,
    selectOption
};
