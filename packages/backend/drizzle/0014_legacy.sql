CREATE TABLE `legacy_migrations` (
	`project_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`archive_file` text NOT NULL,
	`archive_sha256` text NOT NULL,
	`archive_bytes` integer NOT NULL,
	`manifest` text NOT NULL,
	`counts` text,
	`failure` text,
	`started_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "legacy_migrations_status_enum" CHECK("status" in ('archived', 'imported', 'completed'))
);
