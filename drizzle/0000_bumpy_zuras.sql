CREATE TABLE `applications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`company` text NOT NULL,
	`role` text NOT NULL,
	`location` text DEFAULT 'Not specified' NOT NULL,
	`source` text DEFAULT 'Not specified' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`tier` text DEFAULT 'B' NOT NULL,
	`fit_score` integer DEFAULT 7 NOT NULL,
	`status` text DEFAULT 'Applied' NOT NULL,
	`applied_at` text NOT NULL,
	`follow_up_at` text NOT NULL,
	`portfolio_lead` text DEFAULT 'PropertyCard' NOT NULL,
	`resume_version` text DEFAULT 'Product' NOT NULL,
	`contact` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`original_entry` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_applications_user_applied` ON `applications` (`user_id`,`applied_at`);--> statement-breakpoint
CREATE INDEX `idx_applications_user_status` ON `applications` (`user_id`,`status`);
--> statement-breakpoint
PRAGMA optimize;
