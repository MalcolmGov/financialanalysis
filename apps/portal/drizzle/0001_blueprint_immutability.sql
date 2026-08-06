-- Companion migration: blueprint immutability, run alongside the drizzle-kit
-- generated schema migration. Enforces at the storage layer what the app also
-- enforces in code (defense in depth) — a locked blueprint's design bytes and
-- checksum can never change, and only one blueprint per project may be locked.

-- Exactly one locked blueprint per project.
CREATE UNIQUE INDEX IF NOT EXISTS blueprint_one_locked_per_project
  ON blueprint_versions (project_id)
  WHERE status = 'locked';

-- Reject any UPDATE that mutates the design payload or checksum of a locked
-- row. The only permitted transition on a locked row is status -> 'superseded'
-- (the unlock path), which leaves blueprint_json and checksum untouched.
CREATE OR REPLACE FUNCTION forbid_locked_blueprint_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'locked' THEN
    IF NEW.blueprint_json IS DISTINCT FROM OLD.blueprint_json
       OR NEW.checksum IS DISTINCT FROM OLD.checksum THEN
      RAISE EXCEPTION
        'blueprint % is locked; blueprint_json/checksum are immutable', OLD.id;
    END IF;
    IF NEW.status NOT IN ('locked', 'superseded') THEN
      RAISE EXCEPTION
        'locked blueprint % may only transition to superseded, not %', OLD.id, NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_forbid_locked_blueprint_mutation ON blueprint_versions;
CREATE TRIGGER trg_forbid_locked_blueprint_mutation
  BEFORE UPDATE ON blueprint_versions
  FOR EACH ROW
  EXECUTE FUNCTION forbid_locked_blueprint_mutation();
