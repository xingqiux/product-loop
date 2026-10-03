CREATE TABLE `queue_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`at` integer NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`note` text,
	`round_id` integer,
	`actor` text NOT NULL,
	`session` text,
	FOREIGN KEY (`item_id`) REFERENCES `queue_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "queue_events_from_status_enum" CHECK("from_status" in ('todo', 'doing', 'waiting', 'done', 'dropped')),
	CONSTRAINT "queue_events_to_status_enum" CHECK("to_status" in ('todo', 'doing', 'waiting', 'done', 'dropped'))
);
--> statement-breakpoint
CREATE INDEX `queue_events_item` ON `queue_events` (`item_id`);--> statement-breakpoint
CREATE TABLE `queue_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`number` integer NOT NULL,
	`content` text NOT NULL,
	`stage` text NOT NULL,
	`proposer` text NOT NULL,
	`proposed_in_round_id` integer,
	`created_at` integer NOT NULL,
	`status` text NOT NULL,
	`status_note` text,
	`depends_on` text,
	`acceptance` text,
	`evidence` text,
	`sub_items` text NOT NULL,
	`source` text,
	`from_submission_id` integer,
	`from_line` integer,
	`edit_count` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proposed_in_round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "queue_items_stage_enum" CHECK("stage" in ('think', 'use', 'check', 'land', 'improve')),
	CONSTRAINT "queue_items_proposer_enum" CHECK("proposer" in ('user', 'ai', 'review', 'otherProject')),
	CONSTRAINT "queue_items_status_enum" CHECK("status" in ('todo', 'doing', 'waiting', 'done', 'dropped')),
	CONSTRAINT "queue_items_waiting_depends_on" CHECK("status" <> 'waiting' or "depends_on" is not null),
	CONSTRAINT "queue_items_done_evidence" CHECK("status" <> 'done' or "evidence" is not null),
	CONSTRAINT "queue_items_dropped_status_note" CHECK("status" <> 'dropped' or "status_note" is not null),
	CONSTRAINT "queue_items_from_line" CHECK(("from_submission_id" is null) = ("from_line" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `queue_items_number` ON `queue_items` (`project_id`,`number`);