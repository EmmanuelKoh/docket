CREATE TABLE "device_member" (
	"device_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "device_member_device_id_owner_id_pk" PRIMARY KEY("device_id","owner_id")
);
--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "share_code" text;--> statement-breakpoint
ALTER TABLE "device" ADD COLUMN "share_code_expires_at" timestamp;