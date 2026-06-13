const fs = require("fs");
const path = require("path");
const { cleanQuestionLabel, PENDING_FILE } = require("../core/answer-ledger");
const { formatCompanyName } = require("../core/answer-engine");

const AI_WORKFLOW_ANSWER = `I used AI tools to accelerate backend development and workflow automation. For example, while building services at Deutsche Telekom Digital Labs and personal projects, I used AI to understand unfamiliar code paths, draft initial test cases, debug failures faster, and automate repetitive development tasks. What worked well was speeding up boilerplate generation and narrowing down root causes; what required caution was validating generated code and ensuring security and correctness myself. I evaluated usefulness by whether the output reduced iteration time without compromising quality. Next, I want to use AI more systematically for test generation, documentation, and workflow orchestration while keeping strong engineering review standards.`;

const ML_LIMITED_ANSWER = `I am primarily a backend engineer, but I have exposure to data-heavy systems through my internship at Alteryx and backend work involving analytics-oriented APIs. I understand data modeling, pipeline thinking, and production service concerns, though I have not owned end-to-end ML model development in production.`;

const BLOCK_PURPOSE = `Economic empowerment means giving people and businesses access to tools and opportunities that help them participate more fully in the economy, regardless of their background or circumstances. To me, it means reducing barriers, increasing access, and using technology to create more financial opportunity.`;

function todayApplicationDate() {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const yy = String(now.getFullYear()).slice(-2);
    return `${mm}/${dd}/${yy}`;
}

function buildAnswerMap(profile) {
    const motivation = profile.genericMotivation.replace(/\{company\}/gi, "the company");

    return {
        "Twitter": "N/A",
        "Today's Date of Application (MM/DD/YY Format)": todayApplicationDate(),
        "Home Address CEP (Brazil Only)": "N/A",
        "Applicant Privacy Notice": "Yes",
        "Point of Data Transfer": "India",
        "I identify as:": profile.demographics?.genderIdentity || "Woman",
        "Guidelines for using AI in our interviewing process": "Yes, I have read and agree to follow the guidelines.",
        "Optional: Upload your AI example.": "N/A",
        "Upload anything": "N/A",
        "Other Links": `${profile.linkedin}\n${profile.github}`,
        "Do you have experience in any of the following": "Java, Spring Boot, Python, REST APIs, microservices, MongoDB, MySQL, Docker, Git, CI/CD, JUnit, Mockito",
        "If you selected a response to the prior question other than “none of the above,” please confirm whether any of the following also applies to you. Select all that apply.": "None of the above",
        "Are you currently based in any of these countries? Please note these are the only countries where we are accepting applications": "India",
        "Please double-check all the information provided above. Ensuring accuracy is crucial, as any errors or omissions may impact the review of your application.": "Yes, I confirm the information provided is accurate.",
        "(Optional) Personal Preferences": "Open to Remote and Hybrid opportunities",
        "(Optional) Personal Preferences (Optional) Personal Preferences": "Open to Remote and Hybrid opportunities",
        "If yes, please provide further explanation below.": "N/A",
        "If yes, please identify name of person / vendor and describe relationship / association:": "N/A",
        "If yes, please describe:": "N/A",
        "By checking this box, you consent to Okta using your data to evaluate your candidacy for this role and any other current or future roles that may be a fit for your profile. You may request the removal of your data at any time by contacting greenhouse@okta.com.": "Yes",
        "Fingerprint": "N/A",
        "If you answered \"Yes\" to the question above, please enter your dates of employment. Note that your performance history may be reviewed as part of the application process.": "N/A",
        "If you answered \"Yes\" to the question above, please enter your dates of contract engagement or work through agency.": "N/A",
        "By clicking “accept,” you agree that any disputes related to your application, including those related to Block’s selection process, hiring decision, and your background check, shall be submitted to binding arbitration with the Judicial Arbitration and Mediation Services, Inc. (JAMS) on an individual basis only in San Francisco, before a single arbitrator according to the applicable JAMS Rules then in effect, with Block bearing all costs unique to arbitration. To the extent permitted by law, you and Block each waive the right to initiate or participate in any class, collective, or representative action against the other in any forum (including court and arbitration). If any provision of this agreement is deemed unenforceable, the remainder shall remain in effect, except that, notwithstanding the above, under no circumstances shall class or collective, or representative proceedings be permitted in arbitration.": "I accept",
        "Please review the linked document:": "Yes, I have reviewed the document.",
        "If you answered MongoDB Employee, MongoDB Event, or Other, please specify here:": "LinkedIn",
        "It is important to us to create an accessible and inclusive interview experience. Please let us know if there are any adjustments we can make to assist you during the hiring and interview process.": "None",
        "Do you have strong proficiency in at least one modern scripting language (Python, JavaScript/TypeScript, or similar) and a solid understanding of REST APIs, GraphQL, and integration patterns?": "Yes",
        "NATIONALITY - الجنسية": "Indian",
        "Currently working - هل انت على رأس العمل حاليًا": "Yes",
        "FAMILY STATUS - الحالة الإجتماعية": "Single",
        "Are you available to commit to the full 6‑month internship period (1 September 2026 – 31 January 2027) on a full‑time basis (5 days per week / 40 hours per week)?": "No",
        "If yes, please provide your LDAP.": "N/A",
        "Complete the pre-work assignment here and submit your assignments below. Assignment submission is mandatory. We will not consider any application without the proper submission": "N/A",
        "Nickname (if available)": "Dhanya",
        "If you answered 'Yes' above, please provide additional details.": "N/A",
        "Tell us about a time you used AI tools to help you analyze data, automate a workflow, or build something new. If available, share a work-related example. Please include: What you were trying to do, what worked well and what didn’t, how you evaluated the quality or usefulness of the output, and what you would improve or try next.": AI_WORKFLOW_ANSWER,
        "If yes, which companies? Please list here.": "N/A",
        "Do you have a minimum of five years of progressive experience in global compensation?": "No",
        "Do you have experience administering annual merit, bonus, and equity cycles?": "No",
        "Do you have experience with Workday Advanced Compensation module?": "No",
        "Please describe below what parts of the business or which specific teams you have supported with compensation?": "N/A",
        "Have you attended or are you planning to attend any industry conferences this year? Let us know which ones!": "No",
        "Please select your focus area of machine learning:": "Not applicable — I am applying for backend/software engineering roles.",
        "Other Social Accounts": profile.linkedin,
        "Job Offers Communication": "Yes — email preferred",
        "Prénom": profile.firstName,
        "Nom": profile.lastName,
        "Adresse e-mail": profile.email,
        "CV": "Resume attached",
        "Lettre de motivation": motivation,
        "Veuillez nous indiquer si vous êtes ou avez été un fonctionnaire, ou si un de vos proches (conjoint ou famille) est ou a été membre de la fonction publique au cours des 5 dernières années?": "No",
        "À quelle identité de genre pouvez-vous vous identifier le plus?": "Femme",
        "You will lead an AI-first team focused on automating complex logic like quoting and booking. How do you personally stay \"hands-on\" with AI technologies (e.g., LLMs, agents) while managing a team of 6–8 engineers?": "Although I am currently an individual contributor, I stay hands-on with AI by using tools like Cursor and LLM-assisted workflows in my own development, building side projects, and continuously experimenting with agentic patterns, testing, and automation in real codebases.",
        "How familiar are you with modeling in general?": ML_LIMITED_ANSWER,
        "What is your experience working on different stages in the lifecycle of a machine learning model?": ML_LIMITED_ANSWER,
        "What is your experience with machine learning models used in a production environment, to drive business decisions?": ML_LIMITED_ANSWER,
        "Have you managed cloud services at scale via infrastructure as code tooling?": "Limited — experience with Docker, Jenkins-based CI/CD, and cloud-hosted backend deployments.",
        "Have you configured federated access for corporate applications using SAML or OIDC?": "No direct production ownership, but familiar with authentication and backend security concepts.",
        "Do you have domain-level expertise with at least one modern cloud identity solution (e.g., Okta, Ping, EntraID, Auth0, etc)?": "No",
        "Do you have the ability to operate a config management tool like Ansible, Chef, Puppet, Salt, etc? Please list.": "Limited — primarily Docker, Jenkins, and shell scripting.",
        "Have you applied to this role before?": "No",
        "Briefly describe your experience with Ads products": "No direct professional experience with ads products.",
        "Briefly describe your experience with conversion modeling or ranking": "No direct professional experience with conversion modeling or ranking.",
        "Please select up to 2 ethnicities that you most closely identify with.": "Asian, South Asian",
        "Have you attached a compulsory Cover Letter for this job?": "No — resume attached",
        "Aviso de Privacidade de Dados do Airbnb (Airbnb Data Privacy Notice) - Brazil": "I acknowledge",
        "O grupo étnico-racial com o qual você se identifica. Você se declara uma pessoa: (The ethnic-racial group you identify with. You declare yourself as:) - Brazil": "Asian / Indian",
        "Have you attached an English profile?": "Yes",
        "CONSENT TO PRIVACY NOTICE": "Yes",
        "CANDIDATE NON-DISCLOSURE AGREEMENT": "Yes, I agree",
        "If you have experience supporting B2B SaaS/AI engineering compensation, can you please elaborate on your experience in 1-2 sentences?": "N/A — I do not have compensation/HR domain experience.",
        "What's the name you'd prefer us to use throughout the interview process? What's the name you'd prefer us to use throughout the interview process?": profile.preferredName,
        "What's the name you'd prefer us to use throughout the interview process?": profile.preferredName,
        "Block's purpose is economic empowerment. Briefly tell us about what that purpose means to you.": profile.companyMotivations?.Block || BLOCK_PURPOSE
    };
}

function finishPending(profilePath = "profile.json", baseDir = process.cwd()) {
    const pendingPath = path.join(baseDir, PENDING_FILE);
    const resolvedProfilePath = path.resolve(profilePath);
    const profile = JSON.parse(fs.readFileSync(resolvedProfilePath, "utf8"));
    const pending = JSON.parse(fs.readFileSync(pendingPath, "utf8"));
    const answerMap = buildAnswerMap(profile);

    profile.customAnswers = profile.customAnswers || {};
    let filled = 0;

    for (const question of Object.keys(pending)) {
        const cleaned = cleanQuestionLabel(question);
        const answer = answerMap[question] || answerMap[cleaned];
        if (!answer) {
            throw new Error(`Missing drafted answer for: ${question}`);
        }

        profile.customAnswers[cleaned] = answer;
        filled += 1;
    }

    fs.writeFileSync(resolvedProfilePath, `${JSON.stringify(profile, null, 2)}\n`);
    fs.writeFileSync(pendingPath, "{}\n");

    return { filled, profilePath: resolvedProfilePath, pendingPath };
}

if (require.main === module) {
    const result = finishPending();
    process.stdout.write(`${JSON.stringify({ event: "pending_finished", ...result }, null, 2)}\n`);
}

module.exports = { buildAnswerMap, finishPending };
