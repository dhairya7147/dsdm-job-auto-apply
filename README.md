# Job Auto Apply

A local, review-first job application assistant. The Spring Boot API starts and
tracks Playwright jobs. The Node runner opens an application, fills answers it
can identify confidently, uploads the resume, saves a screenshot, and stops
without submitting.

## Current Support

- Greenhouse forms, including forms embedded in company career sites
- Profile-based contact details and common screening questions
- Visible or headless browser runs
- Per-run status, structured logs, and screenshot artifacts
- Manual review before submission

The field matcher deliberately leaves unknown questions unanswered. It does not
invent salary, demographic, legal, or company-specific answers.

## Setup

Requirements:

- Java 21 or newer
- Node.js 18 or newer
- Chromium installed by Playwright

```bash
npm install
npx playwright install chromium
cp profile.example.json profile.json
```

Edit `profile.json` and set `resume` to an existing resume file. Both
`profile.json` and generated artifacts are ignored by Git.

## Run

Start the API:

```bash
./mvnw spring-boot:run
```

Create an application preparation job:

```bash
curl -X POST http://127.0.0.1:8080/api/applications \
  -H 'Content-Type: application/json' \
  -d '{"jobUrl":"https://example.com/job"}'
```

Use the returned `id` to inspect status and logs:

```bash
curl http://127.0.0.1:8080/api/applications/<id>
curl http://127.0.0.1:8080/api/applications
```

Run the browser worker directly:

```bash
node apply.js 'https://example.com/job'
node apply.js 'https://example.com/job' --headless --review-timeout-ms 0
```

## Configuration

Properties are in `src/main/resources/application.properties`:

- `job-auto-apply.project-directory`
- `job-auto-apply.node-command`
- `job-auto-apply.profile-path`
- `job-auto-apply.headless`
- `job-auto-apply.review-timeout-ms`

Artifacts are written under `artifacts/<job-id>/`.

## Tests

```bash
npm test
./mvnw test
```

## Safety Boundary

The current runner never clicks a submit button. CAPTCHA, account login,
consent, and unanswered screening questions remain manual review steps.
