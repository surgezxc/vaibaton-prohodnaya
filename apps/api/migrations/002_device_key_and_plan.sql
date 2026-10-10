-- Уже применённая 001 не переигрывается. Этот файл догоняет живую базу.

ALTER TABLE devices ADD COLUMN IF NOT EXISTS public_key text;
ALTER TABLE devices ALTER COLUMN secret_hash DROP NOT NULL;

CREATE TABLE IF NOT EXISTS plans (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO plans (id, name)
VALUES ('22222222-2222-4222-8222-222222222201', 'Схема объекта')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE zones ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES plans (id);
UPDATE zones
SET plan_id = '22222222-2222-4222-8222-222222222201'
WHERE plan_id IS NULL;

CREATE TABLE IF NOT EXISTS plan_calibration_points (
  plan_id uuid NOT NULL REFERENCES plans (id) ON DELETE CASCADE,
  idx smallint NOT NULL CHECK (idx >= 0 AND idx <= 2),
  pixel_x double precision NOT NULL,
  pixel_y double precision NOT NULL,
  lat double precision NOT NULL,
  lon double precision NOT NULL,
  PRIMARY KEY (plan_id, idx)
);
