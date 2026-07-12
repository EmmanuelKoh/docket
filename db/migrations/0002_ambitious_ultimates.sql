CREATE TABLE "job" (
	"owner_id" text NOT NULL,
	"id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"template" text,
	"data" jsonb,
	"data_url" text,
	"png_url" text,
	"bytes_url" text,
	"png" text,
	"bytes" text,
	"width" integer,
	"height" integer,
	"claimed_at" timestamp,
	CONSTRAINT "job_owner_id_id_pk" PRIMARY KEY("owner_id","id")
);
--> statement-breakpoint
CREATE TABLE "plugin_config" (
	"owner_id" text NOT NULL,
	"plugin_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"schedule" jsonb,
	"config" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_config_owner_id_plugin_id_pk" PRIMARY KEY("owner_id","plugin_id")
);
--> statement-breakpoint
CREATE TABLE "tape_take" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"seconds" real,
	"sample_rate" integer,
	"note_count" integer,
	"has_audio" boolean DEFAULT false NOT NULL,
	"doc_url" text,
	"audio_url" text,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "template" (
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"template" text NOT NULL,
	"data" jsonb,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "template_owner_id_name_pk" PRIMARY KEY("owner_id","name")
);
