CREATE TABLE `bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`stand_id` text NOT NULL,
	`date` text NOT NULL,
	`duty` text NOT NULL,
	`discipline` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_bookings_unique_slot` ON `bookings` (`stand_id`,`date`,`duty`,`discipline`);--> statement-breakpoint
CREATE INDEX `idx_bookings_month_stand` ON `bookings` (`stand_id`,`date`);--> statement-breakpoint
CREATE INDEX `idx_bookings_user_id` ON `bookings` (`user_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`actor_name` text NOT NULL,
	`stand_id` text NOT NULL,
	`date` text NOT NULL,
	`duty` text NOT NULL,
	`discipline` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_events_stand_id_id` ON `events` (`stand_id`,`id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_user_id` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`avatar` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_users_email` ON `users` (`email`);