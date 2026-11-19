ALTER TABLE `applications` ADD `research_status` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `applications` ADD `research_response_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `applications` ADD `dossier_json` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `applications` ADD `tailor_status` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `applications` ADD `tailor_response_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `applications` ADD `tailored_resume` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `applications` ADD `cover_letter` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `applications` ADD `job_description` text DEFAULT '' NOT NULL;