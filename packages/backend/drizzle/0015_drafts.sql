CREATE TABLE `draft_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`page_id` integer NOT NULL,
	`field` text NOT NULL,
	`text` text NOT NULL,
	`reason` text NOT NULL,
	`saved_at` integer NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `drafts`(`page_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "draft_revisions_reason_enum" CHECK("reason" in ('beforeDelete', 'timer', 'beforeRestore'))
);
--> statement-breakpoint
CREATE INDEX `draft_revisions_field` ON `draft_revisions` (`page_id`,`field`);--> statement-breakpoint
CREATE TABLE `drafts` (
	`page_id` integer PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`entries` text NOT NULL,
	`field_meta` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `drafts_project` ON `drafts` (`project_id`);