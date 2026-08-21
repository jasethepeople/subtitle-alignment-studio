CREATE TABLE `uploadParts` (
	`id` varchar(36) NOT NULL,
	`sessionId` varchar(36) NOT NULL,
	`partNumber` int NOT NULL,
	`storageKey` text NOT NULL,
	`sizeBytes` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `uploadParts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `uploadSessions` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`filename` varchar(255) NOT NULL,
	`mimeType` varchar(128) NOT NULL,
	`totalBytes` bigint NOT NULL,
	`chunkSize` int NOT NULL,
	`totalParts` int NOT NULL,
	`status` enum('uploading','assembling','completed','failed') NOT NULL DEFAULT 'uploading',
	`finalAssetId` varchar(36),
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `uploadSessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `mediaAssets` MODIFY COLUMN `sizeBytes` bigint;--> statement-breakpoint
ALTER TABLE `subtitleCues` ADD `qaStatus` enum('clear','needs_review','approved') DEFAULT 'needs_review' NOT NULL;--> statement-breakpoint
ALTER TABLE `subtitleCues` ADD `qaReason` text;