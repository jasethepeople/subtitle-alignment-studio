CREATE TABLE `projectNotificationPreferences` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`inviteEvents` boolean NOT NULL DEFAULT true,
	`qaEvents` boolean NOT NULL DEFAULT true,
	`deliveryEvents` boolean NOT NULL DEFAULT true,
	`exportEvents` boolean NOT NULL DEFAULT true,
	`auditEvents` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `projectNotificationPreferences_id` PRIMARY KEY(`id`)
);
