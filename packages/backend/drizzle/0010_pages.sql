CREATE TABLE `cards` (
	`page_id` integer NOT NULL,
	`section` text NOT NULL,
	`card_id` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`queue` text NOT NULL,
	`scenes` text NOT NULL,
	PRIMARY KEY(`page_id`, `card_id`),
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "cards_section_enum" CHECK("section" in ('align', 'scenes', 'spec', 'asks', 'findings', 'improvements', 'changes', 'refs', 'screens'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cards_page_position` ON `cards` (`page_id`,`position`);--> statement-breakpoint
CREATE TABLE `excerpts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`page_id` integer NOT NULL,
	`where` text NOT NULL,
	`file` text NOT NULL,
	`start_line` integer NOT NULL,
	`end_line` integer NOT NULL,
	`mark` text,
	`text` text NOT NULL,
	`file_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "excerpts_lines" CHECK("start_line" >= 1 and "start_line" <= "end_line")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `excerpts_page_where` ON `excerpts` (`page_id`,`where`);--> statement-breakpoint
CREATE INDEX `excerpts_file` ON `excerpts` (`file`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`round_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`purpose` text NOT NULL,
	`format_version` integer NOT NULL,
	`sections` text NOT NULL,
	`images` text NOT NULL,
	`fill` text NOT NULL,
	`status` text NOT NULL,
	`presented_at` integer NOT NULL,
	`withdrawn_at` integer,
	`withdraw_reason` text,
	`legacy_snapshot` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`legacy_snapshot`) REFERENCES `blobs`(`hash`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "pages_purpose_enum" CHECK("purpose" in ('ask', 'view')),
	CONSTRAINT "pages_status_enum" CHECK("status" in ('presented', 'replied', 'withdrawn')),
	CONSTRAINT "pages_withdrawn_at" CHECK(("status" = 'withdrawn') = ("withdrawn_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pages_round_seq` ON `pages` (`round_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `pages_one_waiting` ON `pages` (`project_id`) WHERE "purpose" = 'ask' and "status" = 'presented';--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_rule_hits` (
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
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "rule_hits_mode_enum" CHECK("mode" in ('current', 'history')),
	CONSTRAINT "rule_hits_layer_enum" CHECK("layer" in ('definition', 'rule', 'writing')),
	CONSTRAINT "rule_hits_level_enum" CHECK("level" in ('block', 'warn')),
	CONSTRAINT "rule_hits_page_date" CHECK(("mode" = 'history') = ("page_date" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_rule_hits`("id", "created_at", "project_id", "round_id", "page_id", "command", "mode", "page_date", "layer", "rule", "level", "where", "message", "hint") SELECT "id", "created_at", "project_id", "round_id", "page_id", "command", "mode", "page_date", "layer", "rule", "level", "where", "message", "hint" FROM `rule_hits`;--> statement-breakpoint
DROP TABLE `rule_hits`;--> statement-breakpoint
ALTER TABLE `__new_rule_hits` RENAME TO `rule_hits`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `rule_hits_project` ON `rule_hits` (`project_id`);--> statement-breakpoint
CREATE INDEX `rule_hits_rule` ON `rule_hits` (`rule`);