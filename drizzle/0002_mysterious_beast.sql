CREATE TABLE `analysis_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`user_id` text,
	`report_id` text,
	`target_github` text,
	`target_x` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`current_step` text,
	`total_steps` integer,
	`completed_steps` integer DEFAULT 0,
	`score_id` text,
	`error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`score_id`) REFERENCES `psychosis_scores`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `analysis_jobs_user_id_idx` ON `analysis_jobs` (`user_id`);--> statement-breakpoint
CREATE INDEX `analysis_jobs_status_idx` ON `analysis_jobs` (`status`);