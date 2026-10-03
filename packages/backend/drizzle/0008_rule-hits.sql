CREATE TABLE `rule_hits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer NOT NULL,
	`project_id` text NOT NULL,
	`round_id` integer,
	`page_id` integer,
	`command` text NOT NULL,
	`mode` text NOT NULL,
	`page_date` text,
	`layer` text NOT NULL,
	`rule` text NOT NULL,
	`level` text NOT NULL,
	`where` text,
	`message` text NOT NULL,
	`hint` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rule_hits_mode_enum" CHECK("mode" in ('current', 'history')),
	CONSTRAINT "rule_hits_layer_enum" CHECK("layer" in ('definition', 'rule', 'writing')),
	CONSTRAINT "rule_hits_level_enum" CHECK("level" in ('block', 'warn')),
	CONSTRAINT "rule_hits_page_date" CHECK(("mode" = 'history') = ("page_date" is not null))
);
--> statement-breakpoint
CREATE INDEX `rule_hits_project` ON `rule_hits` (`project_id`);--> statement-breakpoint
CREATE INDEX `rule_hits_rule` ON `rule_hits` (`rule`);