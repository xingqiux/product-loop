CREATE TABLE `product_versions` (
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`summary` text,
	PRIMARY KEY(`project_id`, `version`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "product_versions_status_enum" CHECK("status" in ('open', 'closed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_versions_one_open` ON `product_versions` (`project_id`) WHERE "status" <> 'closed';--> statement-breakpoint
CREATE TABLE `project_roots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`path` text NOT NULL,
	`added_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_roots_path_unique` ON `project_roots` (`path`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`repo_kind` text NOT NULL,
	`ignore_file` text,
	`skill_version` text,
	`legacy_source` text,
	`created_at` integer NOT NULL,
	`archived_at` integer,
	CONSTRAINT "projects_repo_kind_enum" CHECK("repo_kind" in ('own', 'shared'))
);
--> statement-breakpoint
CREATE TABLE `rounds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`stage` text NOT NULL,
	`seq` integer NOT NULL,
	`ordinal` integer NOT NULL,
	`status` text NOT NULL,
	`started_at` integer NOT NULL,
	`closed_at` integer,
	`close_note` text,
	`legacy_id` text,
	FOREIGN KEY (`project_id`,`version`) REFERENCES `product_versions`(`project_id`,`version`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rounds_stage_enum" CHECK("stage" in ('think', 'use', 'check', 'land', 'improve')),
	CONSTRAINT "rounds_status_enum" CHECK("status" in ('open', 'waiting', 'replied', 'closed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rounds_label` ON `rounds` (`project_id`,`version`,`stage`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `rounds_ordinal` ON `rounds` (`project_id`,`ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `rounds_one_open` ON `rounds` (`project_id`) WHERE "status" <> 'closed';