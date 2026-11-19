ALTER TABLE `automation_queue` ADD `ai_cost_usd` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `automation_settings` ADD `job_limit_usd` real DEFAULT 0.75 NOT NULL;