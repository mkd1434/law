CREATE TABLE `change_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`item_id` int NOT NULL,
	`announcement_no` varchar(255) NOT NULL,
	`effective_date` timestamp NOT NULL,
	`status` enum('current','upcoming') NOT NULL,
	`comparison_data` json,
	`raw_data` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `change_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `monitored_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(500) NOT NULL,
	`type` enum('law','rule') NOT NULL,
	`is_active` int NOT NULL DEFAULT 1,
	`external_id` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `monitored_items_id` PRIMARY KEY(`id`)
);
