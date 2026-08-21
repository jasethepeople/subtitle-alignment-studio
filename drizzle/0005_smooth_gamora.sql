CREATE TABLE `deliveryAuditEvents` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`action` enum('approval_requested','delivery_approved','subtitle_exported') NOT NULL,
	`actorUserId` int NOT NULL,
	`actorName` varchar(128) NOT NULL,
	`payload` json NOT NULL,
	`payloadDigest` varchar(64) NOT NULL,
	`signature` varchar(128) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `deliveryAuditEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `projectActivities` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`eventType` enum('invitation_created','invitation_accepted','invitation_revoked','qa_completed','delivery_submitted','delivery_approved','subtitle_exported','report_exported') NOT NULL,
	`actorUserId` int,
	`actorName` varchar(128),
	`recipientUserId` int,
	`title` varchar(180) NOT NULL,
	`body` text NOT NULL,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `projectActivities_id` PRIMARY KEY(`id`)
);
