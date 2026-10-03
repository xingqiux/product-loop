CREATE TABLE `round_items` (
	`round_id` integer NOT NULL,
	`queue_item_id` integer NOT NULL,
	`result` text,
	`returned_to` text,
	`note` text,
	`taken_at` integer NOT NULL,
	PRIMARY KEY(`round_id`, `queue_item_id`),
	FOREIGN KEY (`round_id`) REFERENCES `rounds`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`queue_item_id`) REFERENCES `queue_items`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "round_items_result_enum" CHECK("result" in ('done', 'returned', 'droppedAtStart')),
	CONSTRAINT "round_items_returned_to_enum" CHECK("returned_to" in ('think', 'use', 'check', 'land', 'improve')),
	CONSTRAINT "round_items_returned_to" CHECK("returned_to" is null or "result" = 'returned')
);
--> statement-breakpoint
ALTER TABLE `rounds` ADD `opened_by_session` text;--> statement-breakpoint
ALTER TABLE `rounds` ADD `opened_by_client` text;--> statement-breakpoint
ALTER TABLE `rounds` ADD `base_commits` text;