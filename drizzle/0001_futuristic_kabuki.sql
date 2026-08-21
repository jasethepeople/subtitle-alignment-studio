CREATE TABLE `mediaAssets` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`kind` enum('video','subtitle','audio','waveform','transcription','export') NOT NULL,
	`storageKey` text NOT NULL,
	`storageUrl` text NOT NULL,
	`filename` varchar(255) NOT NULL,
	`mimeType` varchar(128) NOT NULL,
	`sizeBytes` int,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mediaAssets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `processingRuns` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`type` enum('parse','waveform','transcription','alignment','export') NOT NULL,
	`status` enum('queued','processing','ready','failed') NOT NULL DEFAULT 'queued',
	`summary` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `processingRuns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subtitleCues` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`trackId` varchar(36) NOT NULL,
	`sequence` int NOT NULL,
	`startMs` int NOT NULL,
	`endMs` int NOT NULL,
	`plainText` text NOT NULL,
	`richText` text NOT NULL,
	`assStyle` varchar(128),
	`speaker` varchar(128),
	`alignmentConfidence` int NOT NULL DEFAULT 0,
	`sourceMetadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subtitleCues_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subtitleProjects` (
	`id` varchar(36) NOT NULL,
	`userId` int NOT NULL,
	`title` varchar(180) NOT NULL,
	`sourceLanguage` varchar(16) NOT NULL DEFAULT 'auto',
	`status` enum('draft','queued','processing','ready','attention','failed') NOT NULL DEFAULT 'draft',
	`durationMs` int,
	`activeTrackId` varchar(36),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subtitleProjects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subtitleTracks` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`name` varchar(180) NOT NULL,
	`language` varchar(16) NOT NULL DEFAULT 'und',
	`format` enum('srt','ass') NOT NULL,
	`isPrimary` boolean NOT NULL DEFAULT false,
	`styleProfile` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `subtitleTracks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `translationRuns` (
	`id` varchar(36) NOT NULL,
	`projectId` varchar(36) NOT NULL,
	`sourceTrackId` varchar(36) NOT NULL,
	`targetTrackId` varchar(36),
	`targetLanguage` varchar(16) NOT NULL,
	`model` varchar(128),
	`status` enum('queued','processing','ready','failed') NOT NULL DEFAULT 'queued',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `translationRuns_id` PRIMARY KEY(`id`)
);
