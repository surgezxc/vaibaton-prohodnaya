-- Таблицы из docs/architecture.md. Имена не переименовывать.

CREATE TABLE people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  keycloak_sub text UNIQUE,
  badge_number text,
  position text,
  company text,
  site_name text,
  issuer text,
  valid_until date,
  embedding jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES people (id),
  secret_hash text NOT NULL,
  label text,
  bound_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX devices_person_active ON devices (person_id) WHERE revoked_at IS NULL;

CREATE TABLE attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  nonce text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'scanned', 'decided', 'cancelled')),
  used boolean NOT NULL DEFAULT false,
  person_id uuid REFERENCES people (id),
  device_id uuid REFERENCES devices (id),
  gate_sub text NOT NULL,
  decision text CHECK (decision IS NULL OR decision IN ('allow', 'deny')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);

CREATE INDEX attempts_gate_open ON attempts (gate_sub) WHERE status IN ('pending', 'scanned');

CREATE TABLE shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES people (id),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_seconds integer,
  opened_attempt_id uuid REFERENCES attempts (id),
  closed_attempt_id uuid REFERENCES attempts (id)
);

-- Одна открытая смена на человека. Вторая попытка входа не создаёт строку.
CREATE UNIQUE INDEX shifts_one_open ON shifts (person_id) WHERE ended_at IS NULL;

CREATE TABLE zones (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  photo_id text,
  polygon jsonb,
  control_points jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES shifts (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  zone_id uuid REFERENCES zones (id),
  lat double precision,
  lng double precision,
  source text NOT NULL CHECK (source IN ('gps', 'button'))
);

CREATE INDEX locations_shift_time ON locations (shift_id, recorded_at DESC);

CREATE TABLE journal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at timestamptz NOT NULL DEFAULT now(),
  person_id uuid REFERENCES people (id),
  actor_sub text,
  what text NOT NULL,
  direction text,
  decision text,
  reason text,
  attempt_id uuid REFERENCES attempts (id),
  factors jsonb
);

CREATE INDEX journal_at ON journal (at DESC);

CREATE TABLE visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES shifts (id),
  zone_id uuid NOT NULL REFERENCES zones (id),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE INDEX visits_shift ON visits (shift_id, started_at);
CREATE INDEX visits_zone_time ON visits (zone_id, started_at);

-- Три зоны из пакета. Полигоны пустые: их рисует админ, не код.
INSERT INTO zones (id, name, photo_id) VALUES
  ('11111111-1111-4111-8111-111111111101', 'Бетон', 'Объект/Бетономешалка'),
  ('11111111-1111-4111-8111-111111111102', 'Котлован', 'Объект/Котлован'),
  ('11111111-1111-4111-8111-111111111103', 'Курилка', 'Объект/Место для курения')
ON CONFLICT (id) DO NOTHING;
