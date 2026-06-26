const {
    isSponsorshipQuestion,
    isWorkAuthorizationQuestion,
    resolveAuthorizationAnswer,
    resolveResidencyAnswer
} = require("./authorization-policy");
const { resolveExperienceBracketAnswer } = require("./experience-policy");

const QUESTION_RULES = [
    // General patterns - most specific first
    { pattern: /consent to privacy notice|applicant privacy policy|processing of my personal data|agree to the terms and privacy policy|terms and conditions|i agree$/i, key: "consentToPrivacyNotice" },
    { pattern: /currently working at|currently employed (at|with)|work at .* currently/i, key: "previousEmployee" },
    { pattern: /acknowledge.*(privacy|data protection)|receipt.*(privacy|data protection)|acknowledge.*how my information will be processed/i, key: "consentAcknowledgement" },
    { pattern: /if you are not an eu citizen.*citizenship/i, key: "citizenship" },
    { pattern: /i am fluent in this language/i, key: "languageFluencyConfirm" },

    { pattern: /at least (18|eighteen)|minimum age/i, key: "minimumAgeConfirmed" },
    { pattern: /pronouns?/i, key: "pronouns" },

    // Demographics
    { pattern: /hispanic|latino|latina|latinx/i, key: "demographics.hispanicOrLatino" },
    { pattern: /race or ethnicity/i, key: "demographics.raceEthnicityDetail" },
    { pattern: /race|ethnicity|ethnic background/i, key: "demographics.raceEthnicity" },
    { pattern: /veteran|military service/i, key: "demographics.veteranStatus" },
    { pattern: /disability|disabled/i, key: "demographics.disabilityStatus" },
    { pattern: /sexual orientation/i, key: "demographics.sexualOrientation" },
    { pattern: /lgbtq|identify as a member of the lgbt/i, key: "demographics.lgbtq" },
    { pattern: /transgender|trans identity/i, key: "demographics.transgender" },
    { pattern: /gender identity/i, key: "demographics.genderIdentity" },
    { pattern: /self-identification of gender/i, key: "gender" },
    { pattern: /\bgender\b/i, key: "gender" },

    // Company-specific
    { pattern: /employed by\s+(airbnb|airseva|airbnb global capability center)/i, key: "previousAirbnbEmployee" },
    { pattern: /worked.*(airbnb|airseva|airbnb global capability center)/i, key: "previousAirbnbEmployee" },
    { pattern: /(blood relative|immediate.*relative|family member|parent|sibling|spouse|offspring).*working.*airbnb/i, key: "relativeAtAirbnb" },
    { pattern: /candidate privacy policy|i agree.*candidate privacy policy/i, key: "consentToPrivacyNotice" },
    { pattern: /please provide the name of your current \(or most recent\) company|name of your current \(or most recent\) company|current \(or most recent\) company/i, key: "currentEmployer" },
    { pattern: /please select up to \d+ ethnicit|select up to \d+ ethnicit|ethnicities/i, key: "ethnicities" },
    { pattern: /gdpr_demographic_data_consent_given|consent to .*demographic data|demographic data survey/i, key: "demographicConsent" },

    // General work history
    { pattern: /non[- ]?compete/i, key: "nonCompete" },
    { pattern: /employment agreements.*post-employment restrictions|agreements that may restrict your ability/i, key: "nonCompete" },
    { pattern: /(previously|ever).*(worked|employed)|worked.*(before|previously)/i, key: "previousEmployee" },
    { pattern: /employed by .* in the past|been employed by .* entity/i, key: "previousEmployee" },
    { pattern: /current or former .* employee|alphabet employee|deloitte/i, key: "previousEmployee" },

    // Compliance and consent
    { pattern: /government official|close relative.*government|public official/i, key: "governmentOfficial" },
    { pattern: /interview.*record|ai notetaker|transcribe.*interview|ai to transcribe/i, key: "interviewRecordingConsent" },
    { pattern: /ai policy|ai responsible use|may use ai tools to assist/i, key: "aiPolicyConsent" },
    { pattern: /sanctions and export controls/i, key: "sanctionsCompliance" },

    // Screening
    { pattern: /phd/i, key: "hasPhd" },
    { pattern: /#li-hybrid|li-hybrid|hybrid.*office|in[- ]?person.*office|days a week in office|in office.*days|office-centric hybrid|able to meet this requirement|open to working in person|able to be in[- ]?person|confirm you are able to be in[- ]?person/i, key: "hybridOfficeWilling" },
    { pattern: /legally authorized to work|authorized to work in the united states|authorized to work in the us/i, key: "workAuthorizationByCountry" },
    { pattern: /require.*sponsorship|visa sponsorship|immigration support|work permit sponsorship/i, key: "sponsorshipRequiredByCountry" },
    { pattern: /marketing communications|stay up to date|company and product news/i, key: "marketingOptIn" },
    { pattern: /do you know anyone currently at|know anyone currently at|know anyone who works|family member.*employee|relative.*working/i, key: "knowEmployeeAtCompany" },
    { pattern: /willing and able to commit to the hybrid policy|commit to the hybrid policy/i, key: "hybridOfficeWilling" },
    { pattern: /conflict of interest|significant financial interest.*senior leader|close personal relationship with a senior leader/i, key: "conflictOfInterest" },
    { pattern: /referred to this position by a senior leader|referred.*decision.?maker.*client|referred.*institutional client/i, key: "seniorLeaderReferral" },
    { pattern: /confirm receipt of.*privacy notice|global data privacy notice.*arbitration/i, key: "consentAcknowledgement" },
    { pattern: /which of the following best describes how you use ai tools today/i, key: "aiToolsUsageLevel" },
    { pattern: /what ai tools are you currently using today|how are you using them/i, key: "aiToolsUsageToday" },
    { pattern: /designed and implemented a scalable.*distributed system|scalable, reliable component for a distributed system|cloud-native application/i, key: "distributedSystemsExperience" },
    { pattern: /collaborated with cross-functional teams.*infrastructure|cross-functional teams to prioritize.*infrastructure/i, key: "crossFunctionalCollaborationExample" },
    { pattern: /consent to.*processing your personal information|consent to.*applicant privacy policy/i, key: "consentToPrivacyNotice" },
    { pattern: /acknowledge and agree to this requirement|in-office work.*days per week/i, key: "onsiteRequirementWilling" },
    { pattern: /plan to relocate to.*specified location|relocate to.*specified location/i, key: "willingToRelocate" },
    { pattern: /what country are you based in|country are you based in/i, key: "country" },
    { pattern: /optional practical training/i, key: "optStatus" },
    { pattern: /6 years of data\/analytics engineering/i, key: "sixYearsDataExperience" },
    { pattern: /5 years of full time relevant/i, key: "fiveYearsExperience" },
    { pattern: /10\+ years of total relevant technical/i, key: "tenYearsTechnical" },
    { pattern: /deadlines or timeline considerations/i, key: "timelineConsiderations" },
    { pattern: /interviewed at .* before/i, key: "previousInterview" },
    { pattern: /applied to .* in the last/i, key: "recentApplication" },
    { pattern: /fluent or proficient in arabic/i, key: "speaksArabic" },
    { pattern: /familiarity with artificial intelligence/i, key: "aiFamiliarityRating" },
    { pattern: /preferred coding language/i, key: "preferredCodingLanguage" },
    { pattern: /front end and back end languages/i, key: "codingLanguages" },
    { pattern: /languages you speak fluently/i, key: "languagesSpoken" },
    { pattern: /from where do you intend to work/i, key: "workLocationPreference" },
    { pattern: /cumulative gpa|overall result.*gpa|gpa\b/i, key: "gpa" },
    { pattern: /type to add skills|add skills/i, key: "coreTechnicalStack" },
    { pattern: /education start year|from.*\(yyyy\)|from.*\(actual|expected\).*year/i, key: "educationStartYear" },
    { pattern: /education end year|to.*\(yyyy\)|to.*\(actual|expected\).*year/i, key: "educationEndYear" },
    { pattern: /education start month|from.*month/i, key: "educationStartMonth" },
    { pattern: /education end month|to.*month/i, key: "educationEndMonth" },
    { pattern: /where are you currently based/i, key: "currentLocation" },
    { pattern: /additional information/i, key: "additionalInformation" },
    { pattern: /core technical stack/i, key: "coreTechnicalStack" },
    { pattern: /english level|proficiency in english|advanced english level/i, key: "englishLevel" },
    { pattern: /earliest you would want to start|earliest start/i, key: "earliestStartDate" },
    { pattern: /name pronunciation/i, key: "namePronunciation" },
    { pattern: /contact your current employer/i, key: "contactCurrentEmployer" },
    { pattern: /reasonable accommodation/i, key: "reasonableAccommodation" },
    { pattern: /military status/i, key: "militaryStatus" },
    { pattern: /current salary|current total salary/i, key: "currentSalary" },
    { pattern: /finra license/i, key: "finraLicenses" },
    { pattern: /in-person 5 days|five days a week|four days a week|office at least two days|office-centric hybrid|commutable distance to austin/i, key: "onsiteRequirementWilling" },
    { pattern: /ready to relocate to mumbai|relocate to mumbai/i, key: "mumbaiRelocation" },
    { pattern: /may we contact your current employer/i, key: "contactCurrentEmployer" },
    { pattern: /salary increment expectation|salary expectation/i, key: "salaryExpectation" },
    { pattern: /gitlab username/i, key: "gitlabUsername" },
    { pattern: /roblox username/i, key: "robloxUsername" },
    { pattern: /fluent french/i, key: "speaksFrench" },
    { pattern: /fluent or proficient in arabic/i, key: "speaksArabic" },
    { pattern: /currently enrolled as a student/i, key: "isStudent" },
    { pattern: /public company experience/i, key: "publicCompanyExperience" },
    { pattern: /experience using airtable|used airtable before|airtable before/i, key: "airtableExperience" },
    { pattern: /referred to this role by a current employee|referred by a current employee/i, key: "employeeReferral" },
    { pattern: /worked as a full-time software engineer.*excluding internships|full-time software engineer in a professional setting/i, key: "fullTimeSoftwareExperience" },
    { pattern: /where will you be located for this role/i, key: "roleLocationAnswer" },
    { pattern: /what are you looking for in this opportunity/i, key: "opportunityGoalsAnswer" },
    { pattern: /most complex query you wrote|complex query you wrote/i, key: "complexQueryAnswer" },
    { pattern: /worked on performance measurement|database\/query level performance/i, key: "performanceMeasurementAnswer" },
    { pattern: /confidentiality acknowledgement/i, key: "confidentialityAcknowledgement" },
    { pattern: /gdpr_retention_consent|retain my data for future opportunities/i, key: "gdprRetentionConsent" },
    { pattern: /internal mobility policy acknowledgement/i, key: "internalMobilityAcknowledgement" },
    { pattern: /expected graduation date/i, key: "expectedGraduationDate" },
    { pattern: /do you currently have any offers/i, key: "currentOffers" },
    { pattern: /interview code of conduct/i, key: "interviewCodeOfConduct" },
    { pattern: /mongodb employee.*mongodb event.*please specify|answered mongodb employee/i, key: "source" },
    { pattern: /if yes, please describe|if yes, please provide further explanation/i, key: "yesFollowUpDescription" },
    { pattern: /who is your current or (previous|most recent) employer/i, key: "currentEmployer" },
    { pattern: /^application consent$/i, key: "applicationConsent" },
    { pattern: /massachusetts notification/i, key: "massachusettsNotification" },
    { pattern: /^x profile(?:\s+x profile)*$/i, key: "xProfile" },
    { pattern: /what exceptional work have you done/i, key: "exceptionalWorkAnswer" },
    { pattern: /^google scholar(?:\s+google scholar)*$/i, key: "googleScholar" },
    { pattern: /job code number in the job posting/i, key: "jobPostingCode" },
    { pattern: /access control models.*oauth|oauth.*access control/i, key: "oauthExperience" },
    { pattern: /bachelor.?s or master.?s in computer science/i, key: "csDegree" },
    { pattern: /generative ai and\/or agents|experience with generative ai/i, key: "genAiAgentsExperience" },
    { pattern: /peer-reviewed publications/i, key: "peerReviewedPublications" },
    { pattern: /experience with distributed systems\??$/i, key: "distributedSystemsExperienceYesNo" },
    { pattern: /experience writing concurrent code/i, key: "concurrentCodeExperience" },
    { pattern: /currently a tekion employee/i, key: "tekionEmployee" },
    { pattern: /relationship with, anyone that works for tekion|related to.*tekion/i, key: "tekionRelationship" },
    { pattern: /target base and bonus compensation.*tekion/i, key: "tekionCompensation" },
    { pattern: /personal\/familial relationships.*robinhood|outside business activities.*robinhood/i, key: "robinhoodConflicts" },
    { pattern: /u\.s\. person is defined|whether you are a .?u\.s\. person/i, key: "usPerson" },
    { pattern: /paired coding exercise in python or go|programming language\(s\) do you prefer to use/i, key: "pairedCodingLanguages" },
    { pattern: /^legal address/i, key: "legalAddress" },
    { pattern: /comfortable interviewing for the salary outlined/i, key: "comfortableWithListedSalary" },
    { pattern: /former coreweave employee/i, key: "formerCoreweaveEmployee" },
    { pattern: /designing schemas for sql or nosql/i, key: "databaseSchemaExperience" },
    { pattern: /ai tools in day-to-day development/i, key: "aiToolsDayToDay" },
    { pattern: /current offers you are considering|other job offers in hand/i, key: "currentOffers" },
    { pattern: /paired coding exercise in go|comfortable working in go/i, key: "goComfortable" },
    { pattern: /office hubs in nyc|livingston, nj|santa clara office|four days per week in our san francisco office/i, key: "hybridOfficeWilling" },
    { pattern: /live and work in poland/i, key: "liveAndWorkInPoland" },
    { pattern: /current (annual )?ctc|what is your current ctc/i, key: "currentAnnualCTC" },
    { pattern: /expected (annual )?ctc|what is your expected ctc/i, key: "expectedAnnualCTC" },
    { pattern: /reside in the us except the san francisco bay metro area/i, key: "usResideOutsideMetroConfirm" },
    { pattern: /processing of personal data/i, key: "processingPersonalData" },
    { pattern: /selected .other. for where you learned about samsara/i, key: "samsaraOtherSourceDetail" },
    { pattern: /architecture\/design of a backend system|owned the architecture.*backend/i, key: "backendArchitectureExperience" },
    { pattern: /mentored junior|led technical projects across teams/i, key: "mentorshipExperience" },
    { pattern: /experience working in saas\/itsm/i, key: "saasItsmExperience" },
    { pattern: /experience working java/i, key: "javaExperience" },
    { pattern: /attracts you to working at atomicwork/i, key: "atomicworkAttraction" },
    { pattern: /anchanto.*background verification/i, key: "anchantoBackgroundCheck" },
    { pattern: /what are your superpowers/i, key: "careerSuperpowers" },
    { pattern: /biggest career accomplishments/i, key: "careerAccomplishments" },
    { pattern: /biggest career lessons learned/i, key: "careerLessonsLearned" },
    { pattern: /where have you most recently worked|most recently worked/i, key: "currentEmployer" },
    { pattern: /where do you plan on working from|payroll tax purposes/i, key: "workFromAddress" },
    { pattern: /where are you currently located/i, key: "currentLocation" },
    { pattern: /current\/last company/i, key: "currentEmployer" },
    { pattern: /other url/i, key: "otherUrl" },
    { pattern: /replit profile url/i, key: "replitProfileUrl" },
    { pattern: /share something you built with replit/i, key: "replitProjectShare" },
    { pattern: /where did you find this job posting/i, key: "source" },
    { pattern: /snowflake candidate privacy notice/i, key: "consentToPrivacyNotice" },
    { pattern: /hands-on experience with infrastructure concepts/i, key: "infrastructureExperienceRating" },
    { pattern: /technology you have the most experience with|select the technology you have the most experience/i, key: "primaryTechnology" },
    { pattern: /examples of exceptional performance you want to highlight/i, key: "exceptionalWorkAnswer" },
    { pattern: /which engineering areas are you most interested in/i, key: "engineeringAreaInterest" },
    { pattern: /how'd you get into programming|how did you get into programming/i, key: "programmingOrigin" },
    { pattern: /plan on working from our nyc or sf office|willing to work out of our sf or nyc office/i, key: "hybridOfficeWilling" },
    { pattern: /something you've built recently|something you have built recently/i, key: "recentBuildDescription" },
    { pattern: /rate plaid.?s position in ai|position in ai compared to other tech companies/i, key: "plaidAiRating" },
    { pattern: /technical domain do you prefer|prefer to work in and have most expertise/i, key: "technicalDomainPreference" },
    { pattern: /percentage of time do you generally enjoy spending coding/i, key: "codingTimePercentage" },
    { pattern: /most significant technical achievement/i, key: "careerAccomplishments" },
    { pattern: /where can we find samples of your code/i, key: "github" },
    { pattern: /publications, papers or research/i, key: "peerReviewedPublications" },
    { pattern: /example or evidence of your exceptional ability/i, key: "exceptionalWorkAnswer" },
    { pattern: /where can we learn more about you/i, key: "portfolio" },
    { pattern: /arbitration agreement/i, key: "consentAcknowledgement" },
    { pattern: /singapore citizen|australia citizen|basis of your working rights|if you answered yes, please indicate the basis/i, key: "foreignWorkRightsBasis" },
    { pattern: /how did you hear about this position/i, key: "source" },
    { pattern: /u\.s\. person.*status|which of the following best describes your .?u\.s\. person.? status/i, key: "snowflakeUsPersonStatus" },
    { pattern: /why are you interested in working at plaid/i, key: "plaidInterestReasons" },
    { pattern: /preferred work location|where would you like to work/i, key: "preferredWorkLocations" },
    { pattern: /consent to receiving text messages|text message updates/i, key: "smsConsent" },
    { pattern: /country of residence/i, key: "countryOfResidence" },
    { pattern: /annual salary range requirement|salary range requirement/i, key: "salaryRangeRequirement" },
    { pattern: /available to work from our office|open to work from the office by default|comfortable working fully on-site|ready to commit to our hybrid work model/i, key: "officeAvailabilityWilling" },
    { pattern: /contractual obligations.*axon|impact, impede or interfere with your ability to join axon/i, key: "axonContractualObligations" },
    { pattern: /art\.?\s*13\s*gdpr|notification to candidates acc/i, key: "gdprArticle13Consent" },
    { pattern: /neurodiversity/i, key: "neurodiversity" },
    { pattern: /ethnic or cultural background/i, key: "ethnicOrCulturalBackground" },
    { pattern: /^please specify/i, key: "pleaseSpecifyFollowUp" },
    { pattern: /talent pool/i, key: "talentPoolConsent" },
    { pattern: /^future consideration$/i, key: "futureOpportunitiesOptIn" },
    { pattern: /autoidentifica[cç][aã]o.*étnico-racial|étnico-racial/i, key: "brazilEthnicBackground" },
    { pattern: /autoidentifica[cç][aã]o.*identidade de gênero|identidade de gênero/i, key: "brazilGenderIdentity" },
    { pattern: /autoidentifica[cç][aã]o.*\bgênero\b/i, key: "brazilGender" },
    { pattern: /autoidentifica[cç][aã]o.*orienta[cç][aã]o sexual|orienta[cç][aã]o sexual/i, key: "brazilSexualOrientation" },
    { pattern: /possui alguma defici[eê]ncia/i, key: "brazilDisability" },
    { pattern: /concorda em fornecer as informa[cç][oõ]es de diversidade/i, key: "brazilDiversityConsent" },
    { pattern: /professional references and criminal record checks/i, key: "referencesAndBackgroundChecks" },
    { pattern: /verification of both your identity and authorization to work/i, key: "identityWorkAuthorizationVerification" },
    { pattern: /deemed export license|ear - controlled technology/i, key: "deemedExportLicense" },
    { pattern: /which programming language\(s\) do you have experience with/i, key: "programmingLanguagesExperience" },
    { pattern: /experience with golang/i, key: "goComfortable" },
    { pattern: /based in vilnius/i, key: "basedInVilnius" },
    { pattern: /office in pinheiros|office in florianópolis/i, key: "officeAvailabilityWilling" },
    { pattern: /advanced programming experience with/i, key: "advancedProgrammingTechnologies" },
    { pattern: /when are you available to start/i, key: "noticePeriod" },
    { pattern: /cjis requirements|lawful permanent resident status due to cjis/i, key: "cjisUsCitizenship" },
    { pattern: /currently hold italian citizenship/i, key: "italianCitizenship" },
    { pattern: /prohibited possessor questionnaire/i, key: "prohibitedPossessorAcknowledgement" },
    { pattern: /if you answered "other" above, please note your graduation date/i, key: "otherGraduationDateNote" },
    { pattern: /do you use ai\/llms|use ai\/llms in your daily/i, key: "aiWorkflowStory" },
    { pattern: /using looker/i, key: "lookerExperience" },
    { pattern: /whatsapp messages from stripe/i, key: "whatsappRecruitingOptIn" },
    { pattern: /business trips every/i, key: "businessTravelWilling" },
    // Source & links
    { pattern: /hear about|how did you find|source/i, key: "source" },
    { pattern: /linkedin/i, key: "linkedin" },
    { pattern: /github/i, key: "github" },
    { pattern: /portfolio|personal website|website url/i, key: "portfolio" },

    // Name fields
    { pattern: /preferred name|name you go by/i, key: "preferredName" },
    { pattern: /^name$/i, key: "fullName" },
    { pattern: /full name|legal name/i, key: "fullName" },
    { pattern: /^current company$/i, key: "currentEmployer" },
    { pattern: /why are you interested in working at/i, key: "genericMotivation" },
    { pattern: /anything else we should know about your candidacy/i, key: "additionalInformation" },
    { pattern: /middle name/i, key: "middleName" },
    { pattern: /first name|given name/i, key: "firstName" },
    { pattern: /last name|family name|surname/i, key: "lastName" },

    // Contact
    { pattern: /\bemail\b/i, key: "email" },
    { pattern: /phone device type/i, key: "phoneDeviceType" },
    { pattern: /phone extension/i, key: "phoneExtension" },
    { pattern: /phone number/i, key: "phoneNumber" },
    { pattern: /\bphone|mobile/i, key: "phone" },

    // Address
    { pattern: /street address|address line 1|mailing address/i, key: "streetAddress" },
    { pattern: /home address line 2|address line 2/i, key: "addressLine2" },
    { pattern: /address line 3/i, key: "addressLine3" },
    { pattern: /employee id/i, key: "employeeId" },
    { pattern: /^certification$/i, key: "certificationName" },
    { pattern: /describe a complex data model/i, key: "complexDataModelAnswer" },
    { pattern: /state|province|region/i, key: "state" },
    { pattern: /postal|zip code/i, key: "postalCode" },
    { pattern: /\bcountry\b/i, key: "country" },
    { pattern: /\bcity\b|location/i, key: "city" },

    // Work experience
    { pattern: /^job title$/i, key: "currentTitle" },
    { pattern: /^company$/i, key: "currentEmployer" },
    { pattern: /^url$/i, key: "portfolio" },
    { pattern: /role description/i, key: "roleDescription" },
    { pattern: /currently work here|i currently work here/i, key: "currentlyEmployed" },
    { pattern: /current (company|employer)|where do you currently work/i, key: "currentEmployer" },
    { pattern: /current (or )?(more |most )?recent (job )?title|current (job )?title|current role/i, key: "currentTitle" },
    { pattern: /years? of (professional |relevant )?experience|how many years/i, key: "yearsOfExperience" },

    // Education
    { pattern: /highest (level of )?education|highest degree|degree type/i, key: "highestDegree" },
    { pattern: /university|college|school name/i, key: "university" },
    { pattern: /field of study|major|discipline/i, key: "fieldOfStudy" },
    { pattern: /graduation year|year graduated/i, key: "graduationYear" },

    // Location screening
    { pattern: /currently located in (the )?(us|united states)/i, key: "currentlyInUS" },
    { pattern: /bay area/i, key: "bayAreaRelocation" },

    // Availability
    { pattern: /willing.*relocat|open to relocat/i, key: "willingToRelocate" },
    { pattern: /notice period|when can you start|earliest you would want to start/i, key: "noticePeriod" },

    // Compensation
    { pattern: /salary expectation|expected salary|desired salary|compensation expectation/i, key: "desiredSalary.display" },

    // Short/alternate forms
    { pattern: /\bdegree\b/i, key: "highestDegree" },
    { pattern: /\bschool\b/i, key: "university" },
    { pattern: /\bwebsite\b/i, key: "portfolio" },

    // Technical skills - order matters (more specific patterns first)
    { pattern: /dsa\b|data structure.*algorithm|algorithm.*data structure/i, key: "technicalSkills.dsa" },
    { pattern: /selenium/i, key: "technicalSkills.selenium" },
    { pattern: /\bjava\b(?!script)/i, key: "technicalSkills.java" },
    { pattern: /\bpython\b/i, key: "technicalSkills.python" },
    { pattern: /\bjavascript\b|\bjs\b/i, key: "technicalSkills.javascript" },
    { pattern: /typescript/i, key: "technicalSkills.typescript" },
    { pattern: /\breact\b/i, key: "technicalSkills.react" },
    { pattern: /node\.?js|nodejs/i, key: "technicalSkills.nodeJs" },
    { pattern: /test.*automat|automat.*test/i, key: "technicalSkills.testAutomation" },
    { pattern: /api.*test|test.*api/i, key: "technicalSkills.apiTesting" },
    { pattern: /database.*test|test.*database/i, key: "technicalSkills.databaseTesting" },

    // Motivation & essays
    { pattern: /why.*(interested|apply|join)|interest in (this|the) (role|position|company|opportunity)/i, key: "genericMotivation" },
    { pattern: /why do you want to work/i, key: "genericMotivation" },
    { pattern: /why\s+\w+/i, key: "genericMotivation" },
    { pattern: /what excites you/i, key: "excitementAnswer" },
    { pattern: /which .* value resonates|values can be found on our careers page/i, key: "companyValuesAnswer" },
    { pattern: /first-generation professional/i, key: "firstGenerationProfessional" },
    { pattern: /future job opportunities/i, key: "futureOpportunitiesOptIn" },
    { pattern: /receive alerts for similar jobs/i, key: "jobAlertsOptIn" },
    { pattern: /address from which you plan on working/i, key: "workFromAddress" },
    { pattern: /generative ai demonstrating|leverage ai\/agentic tools/i, key: "genAiToolExperience" },
    { pattern: /engineering management experience/i, key: "engineeringManagementExperience" },
    { pattern: /today.?s date of application/i, key: "applicationDate" },
    { pattern: /applicant privacy notice|consent to privacy notice|candidate non-disclosure/i, key: "consentAcknowledgement" },
    { pattern: /scripting language.*rest apis.*graphql/i, key: "scriptingApiProficiency" },
    { pattern: /accessible and inclusive interview/i, key: "reasonableAccommodation" },
    { pattern: /double-check all the information/i, key: "informationAccuracyConfirm" },
    { pattern: /personal preferences/i, key: "personalPreferences" },
    { pattern: /other social accounts/i, key: "linkedin" },
    { pattern: /nickname/i, key: "nickname" },
    { pattern: /ads products/i, key: "adsProductsExperience" },
    { pattern: /conversion modeling or ranking/i, key: "conversionModelingExperience" },
    { pattern: /applied to this role before/i, key: "appliedToRoleBefore" },
    { pattern: /nationality/i, key: "nationality" },
    { pattern: /family status/i, key: "familyStatus" }
];

function getValue(profile, key) {
    return key.split(".").reduce((value, part) => value?.[part], profile);
}

function isIndiaTarget(context = {}) {
    return /india/i.test(String(context.targetCountry || context.jobLocation || ""));
}

function resolveSalaryAnswer(profile, context = {}) {
    if (isIndiaTarget(context)) {
        return profile.desiredSalaryIndia?.display
            || profile.currentSalary
            || "17 LPA INR";
    }

    return profile.desiredSalary?.display || "USD 160,000";
}

function getCountryAnswer(valuesByCountry, targetCountry) {
    if (!valuesByCountry || !targetCountry) {
        return null;
    }

    const exactKey = Object.keys(valuesByCountry).find(
        (country) => country.toLowerCase() === targetCountry.toLowerCase()
    );

    return exactKey ? valuesByCountry[exactKey] : valuesByCountry.default ?? null;
}

function normalizeQuestion(question) {
    return String(question || "")
        .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, " ")
        .replace(/-labeled-(checkbox|radio)-\d+/gi, " ")
        .replace(/Type here\.{3}/gi, " ")
        .replace(/Start typing\.{3}/gi, " ")
        .replace(/Search schools\.{3}/gi, " ")
        .replace(/OpenAI may use Artificial Intelligence with this application\. Learn more\./gi, " ")
        .replace(/\s+/g, " ")
        .replace(/\*/g, "")
        .trim();
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsWholeTerm(haystack, needle) {
    if (!needle || needle.length < 2) {
        return false;
    }

    const re = new RegExp(`\\b${escapeRegExp(needle)}\\b`, "i");
    return re.test(haystack);
}

function collapseDuplicateFieldLabel(question) {
    return normalizeQuestion(question)
        .replace(/\s+(first_name|last_name|preferred_name|email|phone|country)$/i, "")
        .replace(/^(First Name)\s+\1$/i, "$1")
        .replace(/^(Last Name)\s+\1$/i, "$1")
        .replace(/^(Preferred First Name)\s+\1$/i, "$1")
        .trim();
}

function resolveStructuredNameAnswer(question, profile) {
    const normalized = collapseDuplicateFieldLabel(question);

    if (/preferred first name/i.test(normalized)) {
        const preferred = profile.preferredName || profile.firstName;
        return preferred === undefined || preferred === null || preferred === "" ? null : String(preferred);
    }

    if (/\bfirst name\b/i.test(normalized) && !/preferred/i.test(normalized)) {
        return profile.firstName === undefined || profile.firstName === null || profile.firstName === ""
            ? null
            : String(profile.firstName);
    }

    if (/\blast name\b/i.test(normalized) || /\bfamily name\b/i.test(normalized) || /\bsurname\b/i.test(normalized)) {
        return profile.lastName === undefined || profile.lastName === null || profile.lastName === ""
            ? null
            : String(profile.lastName);
    }

    if (/\bmiddle name\b/i.test(normalized)) {
        return profile.middleName === undefined || profile.middleName === null || profile.middleName === ""
            ? null
            : String(profile.middleName);
    }

    if (/^name$/i.test(normalized)) {
        return profile.fullName === undefined || profile.fullName === null || profile.fullName === ""
            ? null
            : String(profile.fullName);
    }

    return null;
}

function resolveWorkHistoryFieldAnswer(question, profile) {
    const match = String(question || "").match(/(start-date-month|start-date-year|end-date-month|end-date-year|start-month|start-year|end-month|end-year)-+(\d+)/i);
    if (!match) {
        return null;
    }

    const [, rawField, indexStr] = match;
    const job = profile.workHistory?.[Number(indexStr)];
    if (!job) {
        return null;
    }

    const field = rawField.toLowerCase();
    if (field.includes("start") && field.includes("month")) {
        return job.startMonth || null;
    }
    if (field.includes("start") && field.includes("year")) {
        return job.startYear || null;
    }
    if (field.includes("end") && field.includes("month")) {
        return job.current ? "I currently work here" : (job.endMonth || null);
    }
    if (field.includes("end") && field.includes("year")) {
        return job.current ? "" : (job.endYear || null);
    }

    return null;
}

function matchesCustomAnswer(question, key) {
    const normalizedQuestion = normalizeQuestion(question).toLowerCase();
    const normalizedKey = normalizeQuestion(key).toLowerCase();

    if (normalizedQuestion === normalizedKey) {
        return true;
    }

    if (normalizedKey.length <= 8 && /\b(first|last|middle|preferred)\s+name\b/i.test(normalizedQuestion)) {
        return false;
    }

    return containsWholeTerm(question, key) || containsWholeTerm(key, question);
}

function normalizePhoneDigits(phone) {
    const digits = String(phone || "").replace(/\D/g, "");
    if (digits.startsWith("91") && digits.length > 10) {
        return digits.slice(2);
    }

    return digits;
}

function formatCompanyName(slug) {
    if (!slug) {
        return null;
    }

    return String(slug)
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(" ");
}

function resolveMotivationAnswer(profile, context = {}) {
    const companyName = context.companyName || null;
    const byCompany = profile.companyMotivations || {};
    const companyAnswer = companyName ? byCompany[companyName] : null;

    if (companyAnswer) {
        return String(companyAnswer);
    }

    const fallback = profile.genericMotivation;
    if (!fallback) {
        return null;
    }

    return String(fallback).replace(/\{company\}/gi, companyName || "this company");
}

function getApplicationDate() {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const yy = String(now.getFullYear()).slice(-2);
    return `${mm}/${dd}/${yy}`;
}

function resolveJobPostingCode(profile, context = {}) {
    const url = String(context.jobUrl || context.job_url || "");
    const ghMatch = url.match(/[?&]gh_jid=(\d+)/i);
    if (ghMatch) {
        return ghMatch[1];
    }

    const jobsMatch = url.match(/\/jobs\/(\d+)/i);
    if (jobsMatch) {
        return jobsMatch[1];
    }

    const tokenMatch = url.match(/[?&]token=(\d+)/i);
    if (tokenMatch) {
        return tokenMatch[1];
    }

    return profile.jobPostingCode === undefined || profile.jobPostingCode === null || profile.jobPostingCode === ""
        ? "N/A"
        : String(profile.jobPostingCode);
}

function resolveRelocationAnswer(normalized) {
    if (!/\brelocate\b/i.test(normalized)) {
        return null;
    }

    if (/not willing to relocat|unwilling to relocat|unable to relocat|do not wish to relocat/i.test(normalized)) {
        return null;
    }

    if (/willing|open to|able to|would you|do you|are you|plan to|commit|ready to|interested in relocat/i.test(normalized)) {
        return "Yes";
    }

    return null;
}

function resolveConsentStatementAnswer(normalized, profile) {
    if (/^i confirm that i have read the privacy policy/i.test(normalized)) {
        return profile.consentToPrivacyNotice || "Yes";
    }

    if (/^i (hereby )?(agree|confirm)|privacy policy|art\.?\s*13\s*gdpr|notification to candidates acc/i.test(normalized)) {
        return profile.gdprArticle13Consent || profile.consentAcknowledgement || "Yes";
    }

    if (/talent pool|future consideration|contacted should a similar vacancy/i.test(normalized)) {
        return profile.talentPoolConsent || profile.gdprRetentionConsent || profile.futureOpportunitiesOptIn || "Yes";
    }

    if (/^acknowledgment of receipt and review/i.test(normalized)
        || /prohibited possessor questionnaire/i.test(normalized)) {
        return profile.prohibitedPossessorAcknowledgement || profile.consentAcknowledgement || "Yes";
    }

    return null;
}

function resolveAxonScreeningAnswer(normalized, profile) {
    if (/fugitive from justice|unlawful user of.*marijuana|under indictment|court order.*restraining you|adjudicated as a mental defective|misdemeanor crime of domestic violence|convicted in any court.*felony|discharged from the armed forces under dishonorable/i.test(normalized)) {
        return profile.axonProhibitedPossessorAnswers || "No";
    }

    return null;
}

function getAnswer(question, profile, context = {}) {
    const normalized = normalizeQuestion(question);

    const structuredNameAnswer = resolveStructuredNameAnswer(question, profile);
    if (structuredNameAnswer !== null) {
        return structuredNameAnswer;
    }

    const workHistoryAnswer = resolveWorkHistoryFieldAnswer(question, profile);
    if (workHistoryAnswer !== null && workHistoryAnswer !== "") {
        return String(workHistoryAnswer);
    }

    // Prefer explicit per-question overrides provided in the profile.customAnswers
    // Match keys case-insensitively after normalizing whitespace and punctuation.
    if (profile && profile.customAnswers) {
        const normalizedKeys = Object.keys(profile.customAnswers).map((k) => ({
            key: k,
            normalizedKey: normalizeQuestion(k).toLowerCase()
        }));

        const exactEntry = normalizedKeys.find(({ normalizedKey }) => normalized.toLowerCase() === normalizedKey);
        if (exactEntry) {
            const exactValue = profile.customAnswers[exactEntry.key];
            return exactValue === undefined || exactValue === null || exactValue === "" ? null : String(exactValue);
        }

        if (normalized.length >= 15) {
            const matchEntry = normalizedKeys.find(({ key }) => matchesCustomAnswer(normalized, key));
            if (matchEntry) {
                const v = profile.customAnswers[matchEntry.key];
                return v === undefined || v === null || v === "" ? null : String(v);
            }
        }
    }

    if (/\bcountry\b/i.test(normalized) && /\bphone\b/i.test(normalized)) {
        return profile.country === undefined || profile.country === null || profile.country === "" ? null : String(profile.country);
    }

    if (/preferred name/i.test(normalized)) {
        return profile.preferredNameDifferent === true ? "Yes" : "No";
    }

    if (/^language\b/i.test(normalized) && !/programming|coding|scripting/i.test(normalized)) {
        return profile.preferredLanguage || "English";
    }

    if (/\bstart date month\b|\bend date month\b/i.test(normalized)
        && !/(start-date-month|start-month|end-date-month|end-month)-+\d+/i.test(question)) {
        return null;
    }

    if (/what country are you based|country are you based in|which country are you/i.test(normalized)) {
        return profile.country || profile.citizenship || null;
    }

    const relocationAnswer = resolveRelocationAnswer(normalized);
    if (relocationAnswer !== null) {
        return relocationAnswer;
    }

    if (/^i identify as:$/i.test(normalized)) {
        return profile.demographics?.raceEthnicityDetail
            || profile.demographics?.raceEthnicity
            || "South Asian";
    }

    if (/select all that apply/i.test(normalized)
        && /export control|sanctions|confirm whether any of the (below|following) applies/i.test(normalized)) {
        if (/none of the above/i.test(normalized)) {
            return "Yes";
        }

        if (/ordinarily a resident of russia|citizen or permanent resident of cuba/i.test(normalized)) {
            return "No";
        }

        return "No";
    }

    if (/select all that apply/i.test(normalized)
        && /confirm whether any of the following also applies/i.test(normalized)) {
        if (/not applicable|none of these apply to me/i.test(normalized)) {
            return "Yes";
        }

        if (/individual granted (citizenship|permanent residency) in a country other than/i.test(normalized)) {
            return "Yes";
        }

        if (/u\.s\. citizen|u\.s\. non-citizen|green card|asylum|refugee/i.test(normalized)) {
            return "No";
        }

        return "No";
    }

    if (isWorkAuthorizationQuestion(normalized)) {
        return resolveAuthorizationAnswer("authorized", normalized, profile, context);
    }

    if (isSponsorshipQuestion(normalized)) {
        return resolveAuthorizationAnswer("sponsorship", normalized, profile, context);
    }

    const consentAnswer = resolveConsentStatementAnswer(normalized, profile);
    if (consentAnswer !== null) {
        return consentAnswer;
    }

    const axonScreeningAnswer = resolveAxonScreeningAnswer(normalized, profile);
    if (axonScreeningAnswer !== null) {
        return axonScreeningAnswer;
    }

    const residencyAnswer = resolveResidencyAnswer(normalized, profile, context);
    if (residencyAnswer !== null) {
        return residencyAnswer;
    }

    const experienceAnswer = resolveExperienceBracketAnswer(normalized, profile);
    if (experienceAnswer) {
        return experienceAnswer;
    }

    const rule = QUESTION_RULES.find(({ pattern }) => pattern.test(normalized));

    if (!rule) {
        return null;
    }

    if (["desiredSalary.display", "currentSalary", "salaryDisclosure"].includes(rule.key)) {
        return resolveSalaryAnswer(profile, context);
    }

    if (rule.key === "workAuthorizationByCountry") {
        return resolveAuthorizationAnswer("authorized", normalized, profile, context);
    }

    if (rule.key === "sponsorshipRequiredByCountry") {
        return resolveAuthorizationAnswer("sponsorship", normalized, profile, context);
    }

    if (rule.key === "genericMotivation") {
        return resolveMotivationAnswer(profile, context);
    }

    if (rule.key === "minimumAgeConfirmed") {
        return profile.minimumAgeConfirmed ? "Yes" : "No";
    }

    if (rule.key === "applicationDate") {
        return getApplicationDate();
    }

    if (rule.key === "consentAcknowledgement") {
        return profile.consentAcknowledgement || (profile.autoAcknowledgePrivacyReceipt ? "Yes" : null) || "Yes";
    }

    if (rule.key === "languageFluencyConfirm") {
        return profile.languageFluencyConfirm || "Yes";
    }

    if (rule.key === "consentToPrivacyNotice") {
        return profile.consentToPrivacyNotice || "Yes";
    }

    if (rule.key === "phoneNumber") {
        const digits = normalizePhoneDigits(profile.phone);
        return digits || null;
    }

    if (rule.key === "phoneDeviceType") {
        return profile.phoneDeviceType || "Home";
    }

    if (rule.key === "source") {
        const category = profile.workdaySourceCategory;
        const detail = profile.workdaySourceDetail || getValue(profile, rule.key);
        if (category && /hear about|how did you find/i.test(normalized)) {
            return String(category);
        }

        const source = getValue(profile, rule.key);
        if (!source) {
            return null;
        }

        if (/linkedin/i.test(String(source)) && /hear about|how did you find/i.test(normalized)) {
            return String(profile.workdaySourceDetail || "LinkedIn Jobs");
        }

        return String(detail || source);
    }

    if (rule.key === "phoneExtension") {
        const extension = profile.phoneExtension;
        return extension === undefined || extension === null ? "" : String(extension);
    }

    if (["addressLine2", "addressLine3"].includes(rule.key)) {
        const line = getValue(profile, rule.key);
        return line === undefined || line === null ? "" : String(line);
    }

    if (rule.key === "employeeId") {
        return profile.employeeId ?? "N/A";
    }

    if (rule.key === "certificationName") {
        return profile.certificationName ?? "N/A";
    }

    if (rule.key === "complexDataModelAnswer") {
        return profile.complexDataModelAnswer
            || profile.customAnswers?.["Describe a complex data model you've built."]
            || null;
    }

    if (rule.key === "phone") {
        const digits = normalizePhoneDigits(profile.phone);
        return digits || null;
    }

    if (rule.key === "highestDegree") {
        const degree = getValue(profile, rule.key);
        if (!degree) {
            return null;
        }

        if (/bachelor/i.test(String(degree))) {
            return "Bachelor's Degree";
        }

        if (/master/i.test(String(degree))) {
            return "Master's Degree";
        }

        return String(degree);
    }

    if (rule.key === "conflictOfInterest") {
        return profile.conflictOfInterest ?? "No";
    }

    if (rule.key === "seniorLeaderReferral") {
        return profile.seniorLeaderReferral ?? "No";
    }

    if (rule.key === "aiToolsUsageLevel") {
        return profile.aiToolsUsageLevel
            || profile.customAnswers?.["Which of the following best describes how you use AI tools today?"]
            || "I use AI tools regularly for code understanding, test generation, debugging, and accelerating routine development tasks while validating outputs myself.";
    }

    if (rule.key === "aiToolsUsageToday") {
        return profile.aiToolsUsageToday || profile.aiWorkflowStory || null;
    }

    if (rule.key === "distributedSystemsExperience") {
        return profile.distributedSystemsExperience || null;
    }

    if (rule.key === "crossFunctionalCollaborationExample") {
        return profile.crossFunctionalCollaborationExample || null;
    }

    if (rule.key === "fullTimeSoftwareExperience") {
        return profile.fullTimeSoftwareExperience ?? "Yes";
    }

    if (rule.key === "roleLocationAnswer") {
        return profile.roleLocationAnswer || profile.currentLocation || `${profile.city}, ${profile.country}`;
    }

    if (rule.key === "opportunityGoalsAnswer") {
        return profile.opportunityGoalsAnswer || resolveMotivationAnswer(profile, context);
    }

    if (rule.key === "complexQueryAnswer") {
        return profile.complexQueryAnswer || null;
    }

    if (rule.key === "performanceMeasurementAnswer") {
        return profile.performanceMeasurementAnswer || null;
    }

    if (rule.key === "confidentialityAcknowledgement") {
        return profile.confidentialityAcknowledgement ?? "Yes";
    }

    if (rule.key === "gdprRetentionConsent") {
        return profile.gdprRetentionConsent ?? "Yes";
    }

    if (rule.key === "internalMobilityAcknowledgement") {
        return profile.internalMobilityAcknowledgement ?? "Yes";
    }

    if (rule.key === "expectedGraduationDate") {
        return profile.expectedGraduationDate
            || `${profile.educationEndMonth || "May"} ${profile.educationEndYear || profile.graduationYear || "2024"}`;
    }

    if (rule.key === "currentOffers") {
        return profile.currentOffers ?? "No";
    }

    if (rule.key === "interviewCodeOfConduct") {
        return profile.interviewCodeOfConduct ?? "Yes";
    }

    if (rule.key === "yesFollowUpDescription") {
        return profile.yesFollowUpDescription || "N/A";
    }

    if (rule.key === "otherGraduationDateNote") {
        return profile.otherGraduationDateNote || "N/A";
    }

    if (rule.key === "hybridOfficeWilling" || rule.key === "onsiteRequirementWilling") {
        if (/plan on working|willing to work out of our sf or nyc/i.test(normalized)) {
            return profile.hybridOfficeNycSfAnswer || "Yes, open to SF or NYC";
        }
        return profile.hybridOfficeWilling || "Yes";
    }

    if (rule.key === "willingToRelocate" || rule.key === "mumbaiRelocation" || rule.key === "bayAreaRelocation") {
        return "Yes";
    }

    if (rule.key === "csDegree") {
        return profile.csDegree ?? "Yes";
    }

    if (rule.key === "distributedSystemsExperienceYesNo") {
        return profile.distributedSystemsExperienceYesNo ?? "Yes";
    }

    if (rule.key === "concurrentCodeExperience") {
        return profile.concurrentCodeExperience ?? "Yes";
    }

    if (rule.key === "oauthExperience") {
        return profile.oauthExperience ?? "Yes";
    }

    if (rule.key === "peerReviewedPublications") {
        return profile.peerReviewedPublications ?? "No";
    }

    if (rule.key === "tekionEmployee") {
        return profile.tekionEmployee ?? "No";
    }

    if (rule.key === "tekionRelationship") {
        return profile.tekionRelationship ?? "No";
    }

    if (rule.key === "tekionCompensation") {
        return profile.tekionCompensation
            || profile.desiredSalaryIndia?.display
            || profile.desiredSalary?.display
            || null;
    }

    if (rule.key === "genAiAgentsExperience") {
        return profile.genAiAgentsExperience
            || profile.customAnswers?.["Do you have experience in building agentic applications in production? Please give an example"]
            || null;
    }

    if (rule.key === "exceptionalWorkAnswer") {
        return profile.exceptionalWorkAnswer || null;
    }

    if (rule.key === "otherUrl") {
        return profile.otherUrl || profile.github || "N/A";
    }

    if (rule.key === "replitProfileUrl") {
        return profile.replitProfileUrl || "N/A";
    }

    if (rule.key === "snowflakeUsPersonStatus") {
        return profile.snowflakeUsPersonStatus || "None of the above";
    }

    if (rule.key === "countryOfResidence") {
        return profile.countryOfResidence || "Other";
    }

    if (rule.key === "plaidInterestReasons") {
        return profile.plaidInterestReasons
            || "Plaid's Products & Technical Innovation, Ability to Use and Build AI Products";
    }

    if (rule.key === "preferredWorkLocations") {
        const jobLocation = String(context.jobLocation || "").toLowerCase();
        if (jobLocation.includes("london")) {
            return "London Office";
        }
        if (jobLocation.includes("san francisco") || jobLocation.includes("sf")) {
            return "San Francisco HQ";
        }
        if (jobLocation.includes("new york") || jobLocation.includes("nyc")) {
            return "New York City Office";
        }
        if (jobLocation.includes("remote")) {
            return "Remote US";
        }
        return profile.preferredWorkLocations || "Remote US";
    }

    if (rule.key === "plaidAiRating") {
        return profile.plaidAiRating || "3 - About average";
    }

    if (rule.key === "primaryTechnology") {
        return profile.primaryTechnology || "Python";
    }

    if (rule.key === "engineeringAreaInterest") {
        return profile.engineeringAreaInterest
            || "Build the services that power core business functions like making payments, communicating with customers, or orchestrating app workflows.";
    }

    if (rule.key === "programmingOrigin") {
        return profile.programmingOrigin
            || "I got into programming through competitive programming and college coursework at MNNIT, then built stronger backend skills through internships and full-time work on Java/Spring Boot microservices.";
    }

    if (rule.key === "recentBuildDescription") {
        return profile.recentBuildDescription || profile.genAiAgentsExperience || profile.exceptionalWorkAnswer || null;
    }

    if (rule.key === "technicalDomainPreference") {
        return profile.technicalDomainPreference || "Back End";
    }

    if (rule.key === "codingTimePercentage") {
        return profile.codingTimePercentage || "80%";
    }

    if (rule.key === "infrastructureExperienceRating") {
        return profile.infrastructureExperienceRating || "Intermediate";
    }

    if (rule.key === "smsConsent") {
        return profile.smsConsent ?? "Yes";
    }

    if (rule.key === "salaryRangeRequirement") {
        return profile.salaryRangeRequirement
            || profile.desiredSalaryIndia?.display
            || profile.desiredSalary?.display
            || "25 LPA INR";
    }

    if (rule.key === "officeAvailabilityWilling") {
        return profile.officeAvailabilityWilling || profile.hybridOfficeWilling || "Yes";
    }

    if (rule.key === "axonContractualObligations") {
        return profile.axonContractualObligations ?? "No";
    }

    if (rule.key === "gdprArticle13Consent") {
        return profile.gdprArticle13Consent || profile.consentAcknowledgement || "Yes";
    }

    if (rule.key === "neurodiversity") {
        return profile.neurodiversity || "Prefer not to answer";
    }

    if (rule.key === "ethnicOrCulturalBackground") {
        return profile.ethnicOrCulturalBackground
            || profile.demographics?.raceEthnicityDetail
            || profile.demographics?.raceEthnicity
            || "South Asian";
    }

    if (rule.key === "pleaseSpecifyFollowUp") {
        return profile.pleaseSpecifyFollowUp || "N/A";
    }

    if (rule.key === "talentPoolConsent") {
        return profile.talentPoolConsent || profile.gdprRetentionConsent || "Yes";
    }

    if (rule.key === "brazilEthnicBackground") {
        return profile.brazilEthnicBackground || profile.demographics?.raceEthnicityDetail || "South Asian";
    }

    if (rule.key === "brazilGenderIdentity") {
        return profile.brazilGenderIdentity || profile.demographics?.genderIdentity || "Woman";
    }

    if (rule.key === "brazilGender") {
        return profile.brazilGender || profile.gender || "Female";
    }

    if (rule.key === "brazilSexualOrientation") {
        return profile.brazilSexualOrientation || profile.demographics?.sexualOrientation || "Heterosexual";
    }

    if (rule.key === "brazilDisability") {
        return profile.brazilDisability || profile.demographics?.disabilityStatus || "No";
    }

    if (rule.key === "brazilDiversityConsent") {
        return profile.brazilDiversityConsent || profile.demographicConsent || "Yes";
    }

    if (rule.key === "referencesAndBackgroundChecks") {
        return profile.referencesAndBackgroundChecks ?? "Yes";
    }

    if (rule.key === "identityWorkAuthorizationVerification") {
        if (context.targetCountry && profile.workAuthorizationByCountry) {
            const auth = getCountryAnswer(profile.workAuthorizationByCountry, context.targetCountry);
            if (auth) {
                return auth;
            }
        }
        return profile.identityWorkAuthorizationVerification ?? "No";
    }

    if (rule.key === "deemedExportLicense") {
        return profile.deemedExportLicense ?? "No";
    }

    if (rule.key === "programmingLanguagesExperience") {
        return profile.programmingLanguagesExperience
            || profile.pairedCodingLanguages
            || "Java, Python, JavaScript/TypeScript, C++";
    }

    if (rule.key === "basedInVilnius") {
        return profile.basedInVilnius ?? "No";
    }

    if (rule.key === "advancedProgrammingTechnologies") {
        return profile.advancedProgrammingTechnologies || profile.coreTechnicalStack || null;
    }

    if (rule.key === "cjisUsCitizenship") {
        return profile.cjisUsCitizenship ?? "No";
    }

    if (rule.key === "italianCitizenship") {
        return profile.italianCitizenship ?? "No";
    }

    if (rule.key === "prohibitedPossessorAcknowledgement") {
        return profile.prohibitedPossessorAcknowledgement || profile.consentAcknowledgement || "Yes";
    }

    if (rule.key === "foreignWorkRightsBasis") {
        return profile.foreignWorkRightsBasis || "No";
    }

    if (rule.key === "replitProjectShare") {
        return profile.replitProjectShare || profile.genAiAgentsExperience || null;
    }

    if (rule.key === "applicationConsent") {
        return profile.applicationConsent ?? "Yes";
    }

    if (rule.key === "massachusettsNotification") {
        return profile.massachusettsNotification ?? "Yes";
    }

    if (rule.key === "xProfile") {
        return profile.xProfile || profile.twitter || "N/A";
    }

    if (rule.key === "googleScholar") {
        return profile.googleScholar ?? "N/A";
    }

    if (rule.key === "jobPostingCode") {
        return resolveJobPostingCode(profile, context);
    }

    if (rule.key === "robinhoodConflicts") {
        return profile.robinhoodConflicts
            || profile.customAnswers?.["Do you have: a) any Personal/Familial Relationships (current Robinhood employees or employees of Robinhood’s vendors); b) any Outside Business Activities that you wish to continue; c) any investment that is greater than 5% of the outstanding shares of a publicly-traded company; d) any investment in a private company that has a business relationship or that is a current competitor of Robinhood; or e) any Intellectual Property Ownership (patents, trademarks, copyrights) that you wish to retain and/or create/develop while at Robinhood?"]
            || "No";
    }

    if (rule.key === "legalAddress") {
        if (profile.legalAddress) {
            return profile.legalAddress;
        }

        const parts = [
            profile.streetAddress,
            profile.city,
            profile.state,
            profile.postalCode,
            profile.country
        ].filter(Boolean);

        return parts.length > 0 ? parts.join(", ") : null;
    }

    if (rule.key === "currentAnnualCTC") {
        return profile.currentAnnualCTC
            || profile.currentCTC
            || profile.desiredSalaryIndia?.display
            || null;
    }

    if (rule.key === "expectedAnnualCTC") {
        return profile.expectedAnnualCTC
            || profile.expectedCTC
            || "25 LPA INR";
    }

    const answer = getValue(profile, rule.key);
    return answer === undefined || answer === null || answer === "" ? null : String(answer);
}

module.exports = {
    collapseDuplicateFieldLabel,
    formatCompanyName,
    getAnswer,
    getCountryAnswer,
    normalizeQuestion,
    resolveMotivationAnswer,
    resolveAuthorizationAnswer,
    resolveStructuredNameAnswer,
    isWorkAuthorizationQuestion,
    isSponsorshipQuestion
};
