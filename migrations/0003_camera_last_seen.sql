-- Migration 0003: track when an imported camera last appeared in its source.
--
-- The nightly import stamps `lastSeenAt` on every camera it receives. An
-- hourly job then marks cameras that haven't been seen for a while as
-- offline, so cameras a provider removes drop off the globe on their own.
-- Cameras added by hand or by the synthetic seed keep NULL and are never
-- swept.

ALTER TABLE cameras ADD COLUMN lastSeenAt TEXT;

-- Finds one source's cameras by when they were last seen (the stale sweep).
CREATE INDEX cameras_source_last_seen ON cameras (sourceId, lastSeenAt);
