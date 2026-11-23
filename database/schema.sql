-- Day Alertas | PostgreSQL | banco dedicado
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS contact_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id UUID REFERENCES contact_lists(id) ON DELETE SET NULL,
  original_filename TEXT NOT NULL,
  stored_path TEXT,
  file_sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','processing','completed','failed')),
  total_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER NOT NULL DEFAULT 0,
  rejected_rows INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_normalized TEXT,
  phone_e164 TEXT,
  full_name TEXT,
  city TEXT,
  state TEXT,
  interest TEXT,
  source TEXT,
  source_import_id UUID REFERENCES imports(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','unsubscribed','suppressed','invalid')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (email_normalized IS NOT NULL OR phone_e164 IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_email_unique
  ON contacts(email_normalized) WHERE email_normalized IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS contacts_phone_unique
  ON contacts(phone_e164) WHERE phone_e164 IS NOT NULL;

CREATE TABLE IF NOT EXISTS consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp','email')),
  purpose TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('granted','revoked')),
  source TEXT NOT NULL,
  evidence_reference TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS suppression_list (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp','email')),
  destination_hash TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(channel, destination_hash)
);
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp','email')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_approval','approved','scheduled','running','paused','completed','cancelled')),
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGSERIAL PRIMARY KEY,
  actor TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS consent_contact_channel_idx ON consent_records(contact_id, channel, captured_at DESC);
CREATE INDEX IF NOT EXISTS imports_created_at_idx ON imports(created_at DESC);
CREATE INDEX IF NOT EXISTS campaigns_status_idx ON campaigns(status);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs(created_at DESC);
