ALTER TABLE `projectInvitations` ADD `deliveryMode` enum('provider_email','link_copy') DEFAULT 'link_copy' NOT NULL;--> statement-breakpoint
ALTER TABLE `projectInvitations` ADD `deliveryStatus` enum('deferred','link_copied','sent','failed') DEFAULT 'deferred' NOT NULL;--> statement-breakpoint
ALTER TABLE `projectInvitations` ADD `deliveredAt` timestamp;