CREATE TABLE `projectInvitations` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`email` varchar(320) NOT NULL,
	`role` enum('producer','reviewer','viewer') NOT NULL,
	`token` varchar(96) NOT NULL,
	`invitedByUserId` int NOT NULL,
	`status` enum('pending','accepted','revoked','expired') NOT NULL DEFAULT 'pending',
	`expiresAt` timestamp NOT NULL,
	`acceptedAt` timestamp,
	`acceptedByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `projectInvitations_id` PRIMARY KEY(`id`),
	CONSTRAINT `projectInvitations_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `projectMemberships` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`role` enum('producer','reviewer','viewer') NOT NULL,
	`invitedByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projectMemberships_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `subtitleProjects` ADD `deliveryStatus` enum('draft','in_review','approved') DEFAULT 'draft' NOT NULL;