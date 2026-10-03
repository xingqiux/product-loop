CREATE TABLE `screens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`scene` integer NOT NULL,
	`step` integer NOT NULL,
	`width` integer NOT NULL,
	`first_version` integer NOT NULL,
	`shot` text NOT NULL,
	`phash` text NOT NULL,
	`shot_version` integer NOT NULL,
	`base_shot` text,
	`base_phash` text,
	`changed_version` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shot`) REFERENCES `blobs`(`hash`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`base_shot`) REFERENCES `blobs`(`hash`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "screens_base" CHECK(("base_shot" is null) = ("base_phash" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `screens_key` ON `screens` (`project_id`,`scene`,`step`,`width`);--> statement-breakpoint
CREATE TABLE `use_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`round_id` integer NOT NULL,
	`command` text,
	`started_at` integer,
	`finished_at` integer,
	`exit_code` integer,
	`commit` text,
	`coverage` text,
	`environment` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `use_runs_round` ON `use_runs` (`round_id`);--> statement-breakpoint
CREATE INDEX `use_runs_project` ON `use_runs` (`project_id`);--> statement-breakpoint
CREATE TABLE `use_steps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`scene` integer NOT NULL,
	`step` integer NOT NULL,
	`width` integer,
	`do` text NOT NULL,
	`expect` text NOT NULL,
	`result` text NOT NULL,
	`shot` text,
	`facts` text,
	`error` text,
	FOREIGN KEY (`run_id`) REFERENCES `use_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shot`) REFERENCES `blobs`(`hash`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "use_steps_result_enum" CHECK("result" in ('pass', 'broken', 'skipped', 'environment')),
	CONSTRAINT "use_steps_shot_width" CHECK("shot" is null or "width" is not null)
);
--> statement-breakpoint
CREATE INDEX `use_steps_run` ON `use_steps` (`run_id`);