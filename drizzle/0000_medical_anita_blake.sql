CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`userId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`password` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `indexed_repos` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`github_repo_id` integer NOT NULL,
	`full_name` text NOT NULL,
	`default_branch` text,
	`language` text,
	`stars` integer DEFAULT 0,
	`last_indexed_at` integer,
	`index_status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `indexed_repos_user_id_idx` ON `indexed_repos` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `indexed_repos_user_repo_idx` ON `indexed_repos` (`user_id`,`github_repo_id`);--> statement-breakpoint
CREATE TABLE `indexed_tweets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tweet_id` text NOT NULL,
	`text` text NOT NULL,
	`created_at_x` integer,
	`metrics` text,
	`indexed_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `indexed_tweets_tweet_id_idx` ON `indexed_tweets` (`tweet_id`);--> statement-breakpoint
CREATE INDEX `indexed_tweets_user_id_idx` ON `indexed_tweets` (`user_id`);--> statement-breakpoint
CREATE TABLE `psychosis_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`target_github` text,
	`target_x` text,
	`score` integer NOT NULL,
	`zone` text NOT NULL,
	`diagnosis` text,
	`indicators` text,
	`breakdown` text,
	`github_data_used` integer DEFAULT false NOT NULL,
	`x_data_used` integer DEFAULT false NOT NULL,
	`generation_ms` integer,
	`model_version` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `psychosis_scores_user_id_idx` ON `psychosis_scores` (`user_id`);--> statement-breakpoint
CREATE INDEX `psychosis_scores_target_github_idx` ON `psychosis_scores` (`target_github`);--> statement-breakpoint
CREATE INDEX `psychosis_scores_created_at_idx` ON `psychosis_scores` (`created_at`);--> statement-breakpoint
CREATE TABLE `repo_metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_id` text NOT NULL,
	`total_commits` integer DEFAULT 0,
	`total_prs` integer DEFAULT 0,
	`total_issues` integer DEFAULT 0,
	`avg_commit_msg_length` real,
	`commit_time_distribution` text,
	`language_breakdown` text,
	`ai_artifact_count` integer DEFAULT 0,
	`raw_data` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`repo_id`) REFERENCES `indexed_repos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `repo_metadata_repo_id_idx` ON `repo_metadata` (`repo_id`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`reporter_id` text,
	`target_github` text,
	`target_x` text,
	`score_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`reporter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`score_id`) REFERENCES `psychosis_scores`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reports_reporter_id_idx` ON `reports` (`reporter_id`);--> statement-breakpoint
CREATE INDEX `reports_status_idx` ON `reports` (`status`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expiresAt` integer NOT NULL,
	`token` text NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`userId` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer DEFAULT false NOT NULL,
	`image` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL
);
