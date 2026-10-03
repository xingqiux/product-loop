CREATE TABLE `skill_issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`round_id` integer,
	`reported_at` integer NOT NULL,
	`reporter` text NOT NULL,
	`session` text,
	`aspect` text NOT NULL,
	`issue_class` text NOT NULL,
	`example` text NOT NULL,
	`skill_version` text,
	`status` text NOT NULL,
	`note` text,
	`fixed_in` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "skill_issues_status_enum" CHECK("status" in ('new', 'understood', 'confirmed', 'fixed', 'wontFix'))
);
--> statement-breakpoint
CREATE INDEX `skill_issues_status` ON `skill_issues` (`status`);--> statement-breakpoint
CREATE INDEX `skill_issues_project` ON `skill_issues` (`project_id`);