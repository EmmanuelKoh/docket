CREATE TABLE "device" (
	"id" text PRIMARY KEY NOT NULL,
	"hardware_id" text NOT NULL,
	"owner_id" text,
	"name" text,
	"token_hash" text,
	"token_plain" text,
	"pair_code" text,
	"pair_code_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"paired_at" timestamp,
	"revoked_at" timestamp,
	CONSTRAINT "device_hardware_id_unique" UNIQUE("hardware_id")
);
