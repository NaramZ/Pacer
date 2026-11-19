import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const applications = sqliteTable(
  "applications",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    company: text("company").notNull(),
    role: text("role").notNull(),
    location: text("location").notNull().default("Not specified"),
    source: text("source").notNull().default("Not specified"),
    url: text("url").notNull().default(""),
    tier: text("tier").notNull().default("B"),
    fitScore: integer("fit_score").notNull().default(7),
    status: text("status").notNull().default("Applied"),
    appliedAt: text("applied_at").notNull(),
    followUpAt: text("follow_up_at").notNull(),
    portfolioLead: text("portfolio_lead").notNull().default("PropertyCard"),
    resumeVersion: text("resume_version").notNull().default("Product"),
    contact: text("contact").notNull().default(""),
    notes: text("notes").notNull().default(""),
    originalEntry: text("original_entry").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    researchStatus: text("research_status").notNull().default(""),
    researchResponseId: text("research_response_id").notNull().default(""),
    dossierJson: text("dossier_json").notNull().default(""),
    tailorStatus: text("tailor_status").notNull().default(""),
    tailorResponseId: text("tailor_response_id").notNull().default(""),
    tailoredResume: text("tailored_resume").notNull().default(""),
    coverLetter: text("cover_letter").notNull().default(""),
    jobDescription: text("job_description").notNull().default(""),
    // What the helper sent: every field and value, screenshots, confirmation link and time (JSON).
    submissionJson: text("submission_json").notNull().default(""),
  },
  (table) => [
    index("idx_applications_user_applied").on(table.userId, table.appliedAt),
    index("idx_applications_user_status").on(table.userId, table.status),
  ],
);

export const automationSettings = sqliteTable("automation_settings", {
  userId: text("user_id").primaryKey(),
  enabled: integer("enabled").notNull().default(0),
  minFit: integer("min_fit").notNull().default(70),
  dailyLimit: integer("daily_limit").notNull().default(5),
  rolesJson: text("roles_json").notNull().default('["Product Designer","UX Designer","Interaction Designer","UX/UI Designer","Design Systems Designer"]'),
  locationsJson: text("locations_json").notNull().default('["Pittsburgh, PA","Remote — United States"]'),
  excludedTermsJson: text("excluded_terms_json").notNull().default('["unpaid","commission only"]'),
  // Extra titles looked for only at companies marked "creative" (ski resorts, universities, health systems): graphic, brand and marketing design.
  creativeRolesJson: text("creative_roles_json").notNull().default('[]'),
  sourcesJson: text("sources_json").notNull().default('["job-alert-email","web-search","company-careers","greenhouse","lever","ashby"]'),
  // 1 = the helper submits applications itself (unattended); 0 = it stops for the person to review and submit.
  autoSubmit: integer("auto_submit").notNull().default(0),
  // Most AI spend allowed on one application before the helper gives up on it.
  jobLimitUsd: real("job_limit_usd").notNull().default(0.75),
  // "subscription": the person's own Claude plan through Claude Code on their computer; "api": their API key.
  applyEngine: text("apply_engine").notNull().default("subscription"),
  // Where the running helper serves Claude Code (127.0.0.1 only) and the key it expects.
  bridgeUrl: text("bridge_url").notNull().default(""),
  bridgeKey: text("bridge_key").notNull().default(""),
  // When the helper is off: 1 uses the API key for reading jobs and writing documents, 0 uses the free versions.
  apiFallback: integer("api_fallback").notNull().default(1),
  runnerTokenHash: text("runner_token_hash").notNull().default(""),
  // The browser extension's connection code (hashed), separate from the helper's.
  extTokenHash: text("ext_token_hash").notNull().default(""),
  lastHeartbeatAt: text("last_heartbeat_at").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const automationQueue = sqliteTable(
  "automation_queue",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    applicationId: text("application_id").notNull().default(""),
    company: text("company").notNull(),
    role: text("role").notNull(),
    location: text("location").notNull().default("Not specified"),
    source: text("source").notNull().default("Web"),
    sourceUrl: text("source_url").notNull(),
    applicationUrl: text("application_url").notNull().default(""),
    status: text("status").notNull().default("Discovered"),
    fitScore: integer("fit_score").notNull().default(0),
    reason: text("reason").notNull().default(""),
    lastError: text("last_error").notNull().default(""),
    aiCostUsd: real("ai_cost_usd").notNull().default(0),
    confirmationUrl: text("confirmation_url").notNull().default(""),
    // Questions the helper couldn't answer from saved answers, as a JSON array of strings.
    questionsJson: text("questions_json").notNull().default("[]"),
    discoveredAt: text("discovered_at").notNull(),
    submittedAt: text("submitted_at").notNull().default(""),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_automation_queue_user_status").on(table.userId, table.status),
    index("idx_automation_queue_user_source_url").on(table.userId, table.sourceUrl),
  ],
);

export const automationRuns = sqliteTable(
  "automation_runs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    status: text("status").notNull().default("Running"),
    discoveredCount: integer("discovered_count").notNull().default(0),
    submittedCount: integer("submitted_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    summary: text("summary").notNull().default(""),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at").notNull().default(""),
  },
  (table) => [index("idx_automation_runs_user_started").on(table.userId, table.startedAt)],
);

export const profiles = sqliteTable("profiles", {
  userId: text("user_id").primaryKey(),
  fullName: text("full_name").notNull().default(""),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  location: text("location").notNull().default(""),
  links: text("links").notNull().default(""),
  headline: text("headline").notNull().default(""),
  resumeText: text("resume_text").notNull().default(""),
  resumeFileName: text("resume_file_name").notNull().default(""),
  // What the person wants their resume and cover letter to put front and centre.
  focus: text("focus").notNull().default(""),
  // True experience the person has confirmed that isn't written on their resume; tailoring may use it.
  experience: text("experience").notNull().default(""),
  // A second place the person can honestly give employers (e.g. family's address near a city they want to work in),
  // and the job locations it's used for, comma-separated ("New York, Brooklyn, NY").
  secondHome: text("second_home").notNull().default(""),
  secondHomeFor: text("second_home_for").notNull().default(""),
  // "on" when the person says the everyday skills of their profession are theirs even where the resume doesn't list them.
  everydaySkills: text("everyday_skills").notNull().default(""),
  // The user's own Anthropic key, stored only in their local database.
  anthropicApiKey: text("anthropic_api_key").notNull().default(""),
  // Standard answers for application questions (work authorization, salary, etc.), as JSON.
  answersJson: text("answers_json").notNull().default("{}"),
  // Monthly cap on Claude spending, in US dollars. Claude features pause once it's reached.
  monthlyBudgetUsd: real("monthly_budget_usd").notNull().default(5),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

// Companies whose public job boards (Greenhouse, Lever, Ashby) the person follows.
export const companies = sqliteTable(
  "companies",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    ats: text("ats").notNull(),
    token: text("token").notNull(),
    careersUrl: text("careers_url").notNull().default(""),
    jobCount: integer("job_count").notNull().default(0),
    lastCheckedAt: text("last_checked_at").notNull().default(""),
    lastError: text("last_error").notNull().default(""),
    // "" looks for the person's usual titles; "creative" also looks for their creative titles.
    roleSet: text("role_set").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_companies_user").on(table.userId)],
);

// Open postings from followed companies that match the person's search preferences.
export const feedJobs = sqliteTable(
  "feed_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    companyId: text("company_id").notNull(),
    company: text("company").notNull(),
    title: text("title").notNull(),
    location: text("location").notNull().default(""),
    workplace: text("workplace").notNull().default(""),
    url: text("url").notNull(),
    applyUrl: text("apply_url").notNull().default(""),
    salary: text("salary").notNull().default(""),
    description: text("description").notNull().default(""),
    postedAt: text("posted_at").notNull().default(""),
    matchScore: integer("match_score").notNull().default(0),
    status: text("status").notNull().default("new"),
    applicationId: text("application_id").notNull().default(""),
    firstSeenAt: text("first_seen_at").notNull(),
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (table) => [
    index("idx_feed_jobs_user_status").on(table.userId, table.status),
    index("idx_feed_jobs_company").on(table.companyId),
  ],
);

// One row per Claude call, with the tokens Anthropic reported and what they cost.
export const aiUsage = sqliteTable(
  "ai_usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    feature: text("feature").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    webSearches: integer("web_searches").notNull().default(0),
    costUsd: real("cost_usd").notNull().default(0),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_ai_usage_user_created").on(table.userId, table.createdAt)],
);

// Slow Claude work (checking a job, writing documents) runs as a background task, so it keeps going when the page changes.
export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull(),
    target: text("target").notNull().default(""),
    label: text("label").notNull().default(""),
    status: text("status").notNull().default("running"),
    progressJson: text("progress_json").notNull().default("{}"),
    resultJson: text("result_json").notNull().default(""),
    seen: integer("seen").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_tasks_user_status").on(table.userId, table.status)],
);

// Design events the app found (or the person added): meetups, talks, workshops, portfolio reviews, conferences.
export const networkEvents = sqliteTable(
  "network_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    // Local date and time of the event ("2026-11-20T18:00"), as the event page states it.
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull().default(""),
    city: text("city").notNull().default(""),
    venue: text("venue").notNull().default(""),
    url: text("url").notNull().default(""),
    organizer: text("organizer").notNull().default(""),
    kind: text("kind").notNull().default(""),
    cost: text("cost").notNull().default(""),
    summary: text("summary").notNull().default(""),
    // "new" (not decided), "maybe" (interested), "going", "skipped" (not interested), "went" or "missed".
    status: text("status").notNull().default("new"),
    // What the person noted after going: who they met, what to follow up on.
    notes: text("notes").notNull().default(""),
    // 1 when the app opened the event page and found the event on it.
    verified: integer("verified").notNull().default(0),
    source: text("source").notNull().default("search"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_network_events_user_start").on(table.userId, table.startsAt)],
);

// People worth knowing: found for a job, met at an event, or added by hand, with where things stand.
export const contacts = sqliteTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    title: text("title").notNull().default(""),
    company: text("company").notNull().default(""),
    // "hiring manager", "recruiter", "peer", "leader" or "other".
    role: text("role").notNull().default("other"),
    applicationId: text("application_id").notNull().default(""),
    channelsJson: text("channels_json").notNull().default("[]"),
    foundAt: text("found_at").notNull().default(""),
    // A drafted first message, for the person to send themselves.
    message: text("message").notNull().default(""),
    // "to contact", "contacted", "replied", "chat booked", "referred" or "closed".
    status: text("status").notNull().default("to contact"),
    lastContactAt: text("last_contact_at").notNull().default(""),
    nextFollowUpAt: text("next_follow_up_at").notNull().default(""),
    meetingAt: text("meeting_at").notNull().default(""),
    notes: text("notes").notNull().default(""),
    // Where and when the person met them in person: an event from network_events, or a place they typed.
    metEventId: text("met_event_id").notNull().default(""),
    metOn: text("met_on").notNull().default(""),
    metWhere: text("met_where").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_contacts_user").on(table.userId)],
);

