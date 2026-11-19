CREATE TABLE `contacts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`company` text DEFAULT '' NOT NULL,
	`role` text DEFAULT 'other' NOT NULL,
	`application_id` text DEFAULT '' NOT NULL,
	`channels_json` text DEFAULT '[]' NOT NULL,
	`found_at` text DEFAULT '' NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'to contact' NOT NULL,
	`last_contact_at` text DEFAULT '' NOT NULL,
	`next_follow_up_at` text DEFAULT '' NOT NULL,
	`meeting_at` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_contacts_user` ON `contacts` (`user_id`);--> statement-breakpoint
CREATE TABLE `network_events` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`venue` text DEFAULT '' NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`organizer` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT '' NOT NULL,
	`cost` text DEFAULT '' NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`verified` integer DEFAULT 0 NOT NULL,
	`source` text DEFAULT 'search' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_network_events_user_start` ON `network_events` (`user_id`,`starts_at`);