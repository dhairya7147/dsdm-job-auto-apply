const { chromium } = require("playwright");

const JOB_URL = process.argv[2]
    || "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/Israel-Yokneam/Software-Engineer--SPE_JR2015623/apply";

async function main() {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

    const applyUrl = JOB_URL.endsWith("/apply") ? `${JOB_URL}/applyManually` : `${JOB_URL.replace(/\/$/, "")}/apply/applyManually`;
    await page.goto(applyUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000);

    const emailSignIn = page.getByRole("button", { name: /sign in with email/i });
    if (await emailSignIn.isVisible().catch(() => false)) {
        await emailSignIn.click();
        await page.waitForTimeout(2000);
    }

    const createAccount = page.getByText("Create Account", { exact: true });
    if (await createAccount.isVisible().catch(() => false)) {
        await createAccount.click();
        await page.waitForTimeout(3000);
    }

    const info = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        const stepMatch = bodyText.match(/current step\s+(\d+)\s+of\s+(\d+)/i);
        const fields = [...document.querySelectorAll("input, textarea, select, [role='combobox'], button[aria-haspopup='listbox']")]
            .filter((el) => {
                const style = window.getComputedStyle(el);
                return style.display !== "none" && style.visibility !== "hidden" && !el.disabled;
            })
            .slice(0, 30)
            .map((el) => ({
                tag: el.tagName.toLowerCase(),
                type: el.getAttribute("type"),
                automationId: el.getAttribute("data-automation-id"),
                ariaLabel: el.getAttribute("aria-label"),
                id: el.id,
                visible: el.offsetParent !== null
            }));

        const buttons = [...document.querySelectorAll("button, a, [role='button']")]
            .filter((el) => (el.textContent || "").trim().length < 80)
            .map((el) => ({
                tag: el.tagName.toLowerCase(),
                text: (el.textContent || "").trim(),
                automationId: el.getAttribute("data-automation-id"),
                visible: el.offsetParent !== null
            }))
            .filter((el) => el.visible);

        const allInputs = [...document.querySelectorAll("input, textarea, select")]
            .map((el) => ({
                tag: el.tagName.toLowerCase(),
                type: el.getAttribute("type"),
                automationId: el.getAttribute("data-automation-id"),
                hidden: el.type === "hidden" || el.offsetParent === null
            }));

        return {
            url: location.href,
            title: document.title,
            stepMatch: stepMatch ? stepMatch[0] : null,
            hasApplyManually: !!document.querySelector('[data-automation-id="applyManually"]'),
            hasEmailSignIn: buttons.some((b) => /sign in with email/i.test(b.text)),
            hasCreateAccount: bodyText.includes("Create Account"),
            hasSignIn: bodyText.includes("Sign In"),
            fieldCount: fields.length,
            fields,
            buttons,
            allInputCount: allInputs.length,
            visibleInputs: allInputs.filter((el) => !el.hidden),
            bodySnippet: bodyText.slice(0, 1500)
        };
    });

    console.log(JSON.stringify(info, null, 2));
    await browser.close();
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
