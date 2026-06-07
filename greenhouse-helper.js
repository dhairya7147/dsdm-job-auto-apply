function normalize(value) {
    return String(value || "").trim().toLowerCase();
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
    if (requested === "no") {
        return /^(no\b|i am not\b|not a\b|none\b|i do not\b)/.test(candidate);
    }
    if (requested === "yes") {
        return /^(yes\b|i am\b|i have\b)/.test(candidate);
    }

    return false;
}

async function selectOption(field, value) {
    const tagName = await field.evaluate((element) => element.tagName.toLowerCase());

    if (tagName === "select") {
        const options = await field.locator("option").allTextContents();
        const match = options.find((option) => optionMatches(option, value));

        if (!match) {
            throw new Error(`No option matching "${value}"`);
        }

        await field.selectOption({ label: match });
        return;
    }

    await field.click();
    await field.fill(String(value));
    await field.press("ArrowDown");
    await field.press("Enter");
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

async function fillField(field, value) {
    const type = normalize(await field.getAttribute("type"));
    const role = normalize(await field.getAttribute("role"));
    const tagName = await field.evaluate((element) => element.tagName.toLowerCase());

    if (type === "radio") {
        await selectRadio(field, value);
        return;
    }

    if (tagName === "select" || role === "combobox") {
        await selectOption(field, value);
        await field.blur().catch(() => {});
        return;
    }

    if (type === "checkbox") {
        const affirmative = /^(yes|true|1|agree|accepted)$/i.test(String(value));
        await field.setChecked(affirmative);
        return;
    }

    await field.fill(String(value));
    await field.blur().catch(() => {});
}

module.exports = {
    fillField,
    optionMatches,
    selectOption
};
