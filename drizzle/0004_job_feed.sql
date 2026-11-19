CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`ats` text NOT NULL,
	`token` text NOT NULL,
	`careers_url` text DEFAULT '' NOT NULL,
	`job_count` integer DEFAULT 0 NOT NULL,
	`last_checked_at` text DEFAULT '' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_companies_user` ON `companies` (`user_id`);--> statement-breakpoint
CREATE TABLE `feed_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`company_id` text NOT NULL,
	`company` text NOT NULL,
	`title` text NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`workplace` text DEFAULT '' NOT NULL,
	`url` text NOT NULL,
	`apply_url` text DEFAULT '' NOT NULL,
	`salary` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`posted_at` text DEFAULT '' NOT NULL,
	`match_score` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`application_id` text DEFAULT '' NOT NULL,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_feed_jobs_user_status` ON `feed_jobs` (`user_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_feed_jobs_company` ON `feed_jobs` (`company_id`);