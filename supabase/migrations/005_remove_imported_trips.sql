-- Migration 005: Remove old Firebase-imported trips
-- Keep only live webhook trips and budget month limits going forward.

BEGIN;

-- Delete all trips that came from the Firebase import
DELETE FROM trips WHERE source = 'import';

-- Verify: only webhook/manual trips remain
-- SELECT source, count(*) FROM trips GROUP BY source;

COMMIT;
