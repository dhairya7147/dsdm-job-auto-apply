function normalize(value) {
    return String(value || "").trim().toLowerCase();
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getPageScope(root) {
    if (!root) {
        return null;
    }

    if (root.keyboard) {
        return root;
    }

    if (typeof root.page === "function") {
        return root.page();
    }

    return root;
}

async function waitScope(root, ms) {
    const page = getPageScope(root);
    if (!page) {
        return;
    }

    await page.waitForTimeout(ms);
}

async function pressEscape(root) {
    const page = getPageScope(root);
    if (!page?.keyboard) {
        return;
    }

    await page.keyboard.press("Escape").catch(() => {});
}

function containsWholeTerm(haystack, needle) {
    if (!needle || needle.length < 2) {
        return false;
    }

    const re = new RegExp(`\\b${escapeRegExp(needle)}\\b`, "i");
    return re.test(haystack);
}

function optionMatches(option, value) {
    const candidate = normalize(option);
    const requested = normalize(value);

    if (candidate === requested) {
        return true;
    }

    if (requested.length >= 2 && containsWholeTerm(candidate, requested)) {
        return true;
    }

    if (candidate.length >= 2 && containsWholeTerm(requested, candidate)) {
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
    if (requested === "no" || requested === "opt-out" || requested === "opt out") {
        return /^(no\b|i am not\b|not a\b|none\b|i do not\b|opt[\s-]?out\b)/.test(candidate);
    }
    if (requested === "yes" || requested === "opt-in" || requested === "opt in") {
        return /^(yes\b|i am\b|i have\b|opt[\s-]?in\b|i agree\b|agree\b)/.test(candidate);
    }
    if (/not a protected veteran|i am not a protected veteran/i.test(requested)) {
        return /not a protected veteran|don't wish|do not wish|prefer not/i.test(candidate)
            && !/identify as one or more/i.test(candidate);
    }
    if (/do not have a disability|don't have a disability|no.*disability/i.test(requested)) {
        return (/do not have a disability|don't have a disability|not have a disability|no, i do not have a disability/i.test(candidate)
            || (requested.includes("not have") && candidate.includes("not have") && candidate.includes("disability")))
            && !/yes.*disability/i.test(candidate);
    }
    if (/i do not want to answer|don't wish to answer/i.test(requested)) {
        return /do not want to answer|don't wish to answer|decline to self-identify/i.test(candidate);
    }

    return false;
}

function findBestOption(options, value) {
    const exact = options.find((option) => normalize(option) === normalize(value));
    if (exact) {
        return exact;
    }

    const matches = options.filter((option) => optionMatches(option, value));
    if (matches.length > 0) {
        const normalizedValue = normalize(value);
        return matches.sort((left, right) => {
            const leftNorm = normalize(left);
            const rightNorm = normalize(right);
            const leftExact = leftNorm === normalizedValue ? 0 : 1;
            const rightExact = rightNorm === normalizedValue ? 0 : 1;
            if (leftExact !== rightExact) {
                return leftExact - rightExact;
            }

            const leftStarts = leftNorm.startsWith(normalizedValue) ? 0 : 1;
            const rightStarts = rightNorm.startsWith(normalizedValue) ? 0 : 1;
            if (leftStarts !== rightStarts) {
                return leftStarts - rightStarts;
            }

            return leftNorm.length - rightNorm.length;
        })[0];
    }

    const words = normalize(value).split(/\s+/).filter((word) => word.length > 3);
    if (words.length === 0) {
        return null;
    }

    const scored = options
        .map((option) => {
            const candidate = normalize(option);
            const score = words.filter((word) => candidate.includes(word)).length;
            return { option, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score);

    const best = scored[0];
    if (!best) {
        return null;
    }

    const minimumScore = words.length >= 3 ? Math.ceil(words.length * 0.6) : words.length;
    return best.score >= minimumScore ? best.option : null;
}

function findStrictOption(options, value) {
    const requested = normalize(value);

    const exact = options.find((option) => normalize(option) === requested);
    if (exact) {
        return exact;
    }

    return options.find((option) => optionMatches(option, value)) || null;
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
    await pressEscape(root);
    await waitScope(root, 80);

    const fieldId = await field.getAttribute("id") || "";
    const fieldName = [
        await field.getAttribute("aria-label"),
        await field.getAttribute("name"),
        fieldId
    ].filter(Boolean).join(" ");
    const isSchool = /^school--/i.test(fieldId) || /\bschool\b/i.test(fieldName);
    const isCountryField = /\bcountry\b/i.test(fieldName);
    const searchable = isSchool || /discipline/i.test(fieldName) || isCountryField;
    const useStrict = strict || isCountryField;
    const targetValue = isSchool ? "Other" : value;
    const targetFallback = isSchool ? null : fallback;

    if (searchable) {
        await field.click();
        await field.fill(String(targetValue));

        if (isCountryField) {
            for (let attempt = 0; attempt < 8; attempt += 1) {
                await waitScope(root, 200);
                if (await clickOption(field, targetValue, targetFallback, true)) {
                    await dispatchFieldEvents(field);
                    await pressEscape(root);
                    return;
                }
            }
        } else {
            for (let attempt = 0; attempt < 5; attempt += 1) {
                await waitScope(root, 180);
                if (await commitComboboxValue(field, targetValue)) {
                    await pressEscape(root);
                    return;
                }
            }
        }

        if (isSchool) {
            await field.press("Enter");
            await dispatchFieldEvents(field);
            await pressEscape(root);
            return;
        }

        if (!isCountryField && targetFallback) {
            await field.fill(String(targetFallback));
            for (let attempt = 0; attempt < 5; attempt += 1) {
                await waitScope(root, 180);
                if (await commitComboboxValue(field, targetFallback)) {
                    await pressEscape(root);
                    return;
                }
            }
        }

        if (await clickOption(field, targetValue, targetFallback, useStrict)) {
            await dispatchFieldEvents(field);
            await pressEscape(root);
            return;
        }
    }

    const toggle = await getFlyoutToggle(field);
    if (await toggle.count() > 0) {
        await toggle.click();
    } else {
        await field.click();
    }

    await waitScope(root, 150);

    if (await clickOption(field, value, fallback, useStrict)) {
        await dispatchFieldEvents(field);
        await pressEscape(root);
        return;
    }

    if (fallback && await clickOption(field, fallback, null, useStrict)) {
        await dispatchFieldEvents(field);
        await pressEscape(root);
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
