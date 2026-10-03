CREATE TABLE `mainline_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`revision` integer NOT NULL,
	`text` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`source` text NOT NULL,
	`round_id` integer,
	`parsed` text NOT NULL,
	`max_scene_id` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "mainline_revisions_source_enum" CHECK("source" in ('cache', 'migration', 'reply'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mainline_revisions_revision` ON `mainline_revisions` (`project_id`,`revision`);--> statement-breakpoint
CREATE TABLE `scenes` (
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`name` text NOT NULL,
	`who` text,
	`steps` text NOT NULL,
	`first_revision` integer NOT NULL,
	`latest_revision` integer NOT NULL,
	`removed_in_revision` integer,
	PRIMARY KEY(`project_id`, `number`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`first_revision`) REFERENCES `mainline_revisions`(`project_id`,`revision`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`latest_revision`) REFERENCES `mainline_revisions`(`project_id`,`revision`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`project_id`,`removed_in_revision`) REFERENCES `mainline_revisions`(`project_id`,`revision`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "scenes_first_latest" CHECK("first_revision" <= "latest_revision"),
	CONSTRAINT "scenes_removed_after_latest" CHECK("removed_in_revision" > "latest_revision")
);
