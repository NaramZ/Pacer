ALTER TABLE `applications` ADD `submission_json` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `automation_settings` ADD `auto_submit` integer DEFAULT 0 NOT NULL;