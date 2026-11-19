CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`full_name` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`links` text DEFAULT '' NOT NULL,
	`headline` text DEFAULT '' NOT NULL,
	`resume_text` text DEFAULT '' NOT NULL,
	`resume_file_name` text DEFAULT '' NOT NULL,
	`anthropic_api_key` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
