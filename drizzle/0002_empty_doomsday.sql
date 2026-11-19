CREATE TABLE `automation_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`application_id` text DEFAULT '' NOT NULL,
	`company` text NOT NULL,
	`role` text NOT NULL,
	`location` text DEFAULT 'Not specified' NOT NULL,
	`source` text DEFAULT 'Web' NOT NULL,
	`source_url` text NOT NULL,
	`application_url` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'Discovered' NOT NULL,
	`fit_score` integer DEFAULT 0 NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`confirmation_url` text DEFAULT '' NOT NULL,
	`discovered_at` text NOT NULL,
	`submitted_at` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_automation_queue_user_status` ON `automation_queue` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_automation_queue_user_source_url` ON `automation_queue` (`user_id`,`source_url`);--> statement-breakpoint
CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`status` text DEFAULT 'Running' NOT NULL,
	`discovered_count` integer DEFAULT 0 NOT NULL,
	`submitted_count` integer DEFAULT 0 NOT NULL,
	`skipped_count` integer DEFAULT 0 NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_automation_runs_user_started` ON `automation_runs` (`user_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `automation_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 0 NOT NULL,
	`min_fit` integer DEFAULT 70 NOT NULL,
	`daily_limit` integer DEFAULT 5 NOT NULL,
	`roles_json` text DEFAULT '["Product Designer","UX Designer","Interaction Designer","UX/UI Designer","Design Systems Designer"]' NOT NULL,
	`locations_json` text DEFAULT '["Pittsburgh, PA","Remote — United States"]' NOT NULL,
	`excluded_terms_json` text DEFAULT '["unpaid","commission only"]' NOT NULL,
	`sources_json` text DEFAULT '["job-alert-email","web-search","company-careers","greenhouse","lever","ashby"]' NOT NULL,
	`runner_token_hash` text DEFAULT '' NOT NULL,
	`last_heartbeat_at` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
