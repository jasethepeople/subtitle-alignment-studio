CREATE TABLE `cueAssignments` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`cueId` varchar(36) NOT NULL,
	`assigneeUserId` int,
	`assigneeName` varchar(128) NOT NULL,
	`assignedByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `cueAssignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cueComments` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`cueId` varchar(36) NOT NULL,
	`authorUserId` int NOT NULL,
	`authorName` varchar(128) NOT NULL,
	`body` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cueComments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cueStatusHistory` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`cueId` varchar(36) NOT NULL,
	`previousStatus` enum('clear','needs_review','approved'),
	`nextStatus` enum('clear','needs_review','approved') NOT NULL,
	`reason` text,
	`changedByUserId` int,
	`changedByName` varchar(128),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cueStatusHistory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `subtitleProjects` ADD `uploadConcurrency` int DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE `subtitleProjects` ADD `uploadRetryLimit` int DEFAULT 3 NOT NULL;