CREATE TABLE `command_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`round_id` integer,
	`purpose` text NOT NULL,
	`command` text NOT NULL,
	`cwd` text NOT NULL,
	`exit_code` integer NOT NULL,
	`output_tail` text NOT NULL,
	`commit` text,
	`started_at` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`cli_version` text NOT NULL,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "command_runs_purpose_enum" CHECK("purpose" in ('tidyCheck', 'red', 'green', 'useCode', 'other')),
	CONSTRAINT "command_runs_exit_code" CHECK("exit_code" >= 0),
	CONSTRAINT "command_runs_duration_ms" CHECK("duration_ms" >= 0)
);
--> statement-breakpoint
CREATE INDEX `command_runs_round` ON `command_runs` (`round_id`);--> statement-breakpoint
CREATE TABLE `land_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`land_record_id` integer NOT NULL,
	`name` text NOT NULL,
	`queue_numbers` text NOT NULL,
	`red_run_id` integer NOT NULL,
	`green_run_id` integer,
	`commit` text,
	`commits_after_red` text,
	FOREIGN KEY (`land_record_id`) REFERENCES `land_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`red_run_id`) REFERENCES `command_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`green_run_id`) REFERENCES `command_runs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "land_changes_commit" CHECK(("green_run_id" is null) = ("commit" is null)),
	CONSTRAINT "land_changes_commits_after_red" CHECK(("green_run_id" is null) = ("commits_after_red" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `land_changes_name` ON `land_changes` (`land_record_id`,`name`);--> statement-breakpoint
CREATE TABLE `land_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`round_id` integer NOT NULL,
	`plan_text` text NOT NULL,
	`plan_sections` text NOT NULL,
	`plan_tidy` text NOT NULL,
	`verdicts` text NOT NULL,
	`planned_at` integer NOT NULL,
	`tidy_skip_reason` text,
	`tidy_run_id` integer,
	`tidied_at` integer,
	`review_opinions` text,
	`review_skip_reason` text,
	`review_diff` text,
	`reviewed_at` integer,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tidy_run_id`) REFERENCES `command_runs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "land_records_tidy" CHECK("tidy_skip_reason" is null or "tidy_run_id" is null),
	CONSTRAINT "land_records_tidied_at" CHECK(("tidied_at" is null) = ("tidy_skip_reason" is null and "tidy_run_id" is null)),
	CONSTRAINT "land_records_review" CHECK("review_opinions" is null or "review_skip_reason" is null),
	CONSTRAINT "land_records_reviewed_at" CHECK(("reviewed_at" is null) = ("review_opinions" is null and "review_skip_reason" is null)),
	CONSTRAINT "land_records_review_skip_diff" CHECK("review_skip_reason" is null or "review_diff" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `land_records_round` ON `land_records` (`round_id`);