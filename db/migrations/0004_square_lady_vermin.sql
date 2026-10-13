ALTER TABLE "job" ADD COLUMN "kind" text DEFAULT 'template' NOT NULL;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "encoding" jsonb;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "data_key" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "png_key" text;--> statement-breakpoint
ALTER TABLE "job" ADD COLUMN "bytes_key" text;--> statement-breakpoint
ALTER TABLE "tape_take" ADD COLUMN "doc_key" text;--> statement-breakpoint
ALTER TABLE "tape_take" ADD COLUMN "audio_key" text;--> statement-breakpoint
UPDATE "job" SET "kind" = 'raw' WHERE "template" IS NULL;