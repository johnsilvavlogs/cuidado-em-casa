CREATE TABLE `account_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `account_session_account` ON `account_sessions` (`account_id`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_salt` text NOT NULL,
	`password_hash` text NOT NULL,
	`case_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `care_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_email_unique` ON `accounts` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_case_id_unique` ON `accounts` (`case_id`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`role` text NOT NULL,
	`event_type` text NOT NULL,
	`request_id` text,
	`created_at` text NOT NULL,
	`before_json` text,
	`after_json` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `care_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_case` ON `audit_events` (`case_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `care_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`state_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `demo_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`role` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `care_cases`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "demo_role" CHECK("demo_sessions"."role" IN ('patient', 'caregiver'))
);
--> statement-breakpoint
CREATE INDEX `session_case` ON `demo_sessions` (`case_id`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`name` text NOT NULL,
	`mime_type` text NOT NULL,
	`file_name` text NOT NULL,
	`sha256` text NOT NULL,
	`byte_length` integer NOT NULL,
	`page_count` integer,
	FOREIGN KEY (`case_id`) REFERENCES `care_cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `document_case` ON `documents` (`case_id`);--> statement-breakpoint
CREATE TABLE `login_attempts` (
	`email_hash` text PRIMARY KEY NOT NULL,
	`attempts` integer NOT NULL,
	`window_started_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `operations` (
	`case_id` text NOT NULL,
	`request_id` text NOT NULL,
	`role` text NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`case_id`, `request_id`),
	FOREIGN KEY (`case_id`) REFERENCES `care_cases`(`id`) ON UPDATE no action ON DELETE no action
);
