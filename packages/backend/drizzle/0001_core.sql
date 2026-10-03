CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer NOT NULL,
	`project_id` text NOT NULL,
	`client` text NOT NULL,
	`session` text,
	`kind` text NOT NULL,
	`object_type` text NOT NULL,
	`object_id` text NOT NULL,
	`detail` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_project` ON `events` (`project_id`);--> statement-breakpoint
CREATE INDEX `events_object` ON `events` (`object_type`,`object_id`);--> statement-breakpoint
CREATE TABLE `idempotency_keys` (
	`key` text NOT NULL,
	`operation` text NOT NULL,
	`result` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`key`, `operation`)
);
--> statement-breakpoint
CREATE INDEX `idempotency_keys_created_at` ON `idempotency_keys` (`created_at`);