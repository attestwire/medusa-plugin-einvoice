import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260816031159 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "einvoice_document" drop constraint if exists "einvoice_document_invoice_number_unique";`);
    this.addSql(`create table if not exists "einvoice_document" ("id" text not null, "order_id" text not null, "invoice_number" text not null, "profile" text not null, "syntax" text not null, "currency" text not null, "valid" boolean not null default false, "xml" text null, "report" jsonb null, "record_url" text null, "engine_version" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "einvoice_document_pkey" primary key ("id"));`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_einvoice_document_order_id" ON "einvoice_document" ("order_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_einvoice_document_deleted_at" ON "einvoice_document" ("deleted_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_einvoice_document_invoice_number_unique" ON "einvoice_document" ("invoice_number") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "einvoice_document" cascade;`);
  }

}
