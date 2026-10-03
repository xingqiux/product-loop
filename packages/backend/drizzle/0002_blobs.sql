CREATE TABLE `blob_refs` (
	`blob_hash` text NOT NULL,
	`referrer_kind` text NOT NULL,
	`referrer_id` text NOT NULL,
	`purpose` text NOT NULL,
	PRIMARY KEY(`referrer_kind`, `referrer_id`, `purpose`, `blob_hash`),
	FOREIGN KEY (`blob_hash`) REFERENCES `blobs`(`hash`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "blob_refs_referrer_kind_enum" CHECK("referrer_kind" in ('page', 'draft', 'replyLine', 'useStep', 'screen', 'round'))
);
--> statement-breakpoint
CREATE INDEX `blob_refs_blob_hash` ON `blob_refs` (`blob_hash`);--> statement-breakpoint
CREATE TABLE `blobs` (
	`hash` text PRIMARY KEY NOT NULL,
	`content_type` text NOT NULL,
	`size` integer NOT NULL,
	`width` integer,
	`height` integer,
	`created_at` integer NOT NULL,
	`first_source` text NOT NULL
);
