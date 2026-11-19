CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`target` text DEFAULT '' NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`progress_json` text DEFAULT '{}' NOT NULL,
	`result_json` text DEFAULT '' NOT NULL,
	`seen` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_tasks_user_status` ON `tasks` (`user_id`,`status`);