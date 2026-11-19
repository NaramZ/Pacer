ALTER TABLE `automation_settings` ADD `creative_roles_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `companies` ADD `role_set` text DEFAULT '' NOT NULL;