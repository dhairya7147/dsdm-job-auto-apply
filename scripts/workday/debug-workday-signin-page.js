const { chromium } = require("playwright");

async function main() {
    const browser = await chromium.launch({ headless: true, channel: "chrome" });
    const page = await browser.newPage();
    const url = "https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/Israel-Yokneam/Software-Engineer--SPE_JR2015623/apply/applyManually";
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(5000);
    await page.getByRole("button", { name: /sign in with email/i }).click().catch(() => {});
    await page.waitForTimeout(3000);

    const info = await page.evaluate(() => {
        return [...document.querySelectorAll("button, a, [role='button']")]
            .filter((el) => /create account|sign in/i.test(el.textContent || ""))
            .map((el) => ({
                tag: el.tagName,
                text: (el.textContent || "").trim(),
                automationId: el.getAttribute("data-automation-id")
            }));
    });
    console.log(JSON.stringify(info, null, 2));
    await browser.close();
}

main();
