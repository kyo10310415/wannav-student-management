-- Optional compatibility inspection. Not a migration; do not modify data.
-- Run only through an approved read-only database connection.
-- Output contains aggregate counts only: no emails, filenames, image bytes, IDs or message text.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '10s';

SELECT COUNT(*) AS image_count FROM broadcast_images;

WITH actors AS (
  SELECT LOWER(email) AS actor, COUNT(*) AS actor_count, MIN(role) AS role
  FROM users GROUP BY LOWER(email)
)
SELECT
  COUNT(*) FILTER (WHERE a.actor IS NULL) AS missing_uploader_count,
  COUNT(*) FILTER (WHERE a.actor_count > 1) AS ambiguous_uploader_count,
  COUNT(*) FILTER (WHERE a.actor_count = 1 AND (a.role IS NULL OR a.role NOT IN ('admin','leader','crew'))) AS unsupported_uploader_count
FROM broadcast_images i LEFT JOIN actors a ON a.actor = LOWER(i.uploaded_by);

WITH actors AS (
  SELECT LOWER(email) AS actor, COUNT(*) AS actor_count, MIN(role) AS role
  FROM users GROUP BY LOWER(email)
), refs AS (
  SELECT CASE WHEN b.is_scheduled THEN 'schedule' WHEN b.is_template THEN 'template' ELSE 'other' END AS record_kind,
    i.image_id AS matched_image,
    a.actor_count, a.role,
    LOWER(i.uploaded_by) IS DISTINCT FROM LOWER(b.created_by) AS different_owner
  FROM broadcast_messages b
  LEFT JOIN broadcast_images i ON i.image_id = b.image_url
  LEFT JOIN actors a ON a.actor = LOWER(b.created_by)
  WHERE b.image_url IS NOT NULL AND b.image_url <> ''
)
SELECT record_kind,
  COUNT(*) AS reference_count,
  COUNT(*) FILTER (WHERE matched_image IS NULL) AS missing_image_count,
  COUNT(*) FILTER (WHERE actor_count IS NULL OR actor_count <> 1 OR role IS NULL OR role NOT IN ('admin','leader','crew')) AS unresolvable_creator_count,
  COUNT(*) FILTER (WHERE matched_image IS NOT NULL AND actor_count = 1 AND role = 'crew' AND different_owner) AS crew_foreign_reference_count,
  COUNT(*) FILTER (WHERE matched_image IS NOT NULL AND actor_count = 1 AND role IN ('admin','leader') AND different_owner) AS manager_foreign_reference_count
FROM refs GROUP BY record_kind ORDER BY record_kind;

WITH actors AS (
  SELECT LOWER(email) AS actor, COUNT(*) AS actor_count, MIN(role) AS role
  FROM users GROUP BY LOWER(email)
)
SELECT j.status, COUNT(*) AS image_job_count,
  COUNT(*) FILTER (WHERE i.image_id IS NULL) AS missing_image_count,
  COUNT(*) FILTER (WHERE a.actor_count IS NULL OR a.actor_count <> 1 OR (a.role IS NULL OR a.role NOT IN ('admin','leader','crew'))) AS unresolvable_creator_count,
  COUNT(*) FILTER (WHERE i.image_id IS NOT NULL AND a.actor_count = 1 AND a.role = 'crew' AND LOWER(i.uploaded_by) IS DISTINCT FROM LOWER(j.created_by)) AS crew_foreign_reference_count
FROM broadcast_jobs j
JOIN broadcast_messages b ON b.id = j.broadcast_id
LEFT JOIN broadcast_images i ON i.image_id = b.image_url
LEFT JOIN actors a ON a.actor = LOWER(j.created_by)
WHERE j.status IN ('pending','running','interrupted','needs_review')
  AND b.image_url IS NOT NULL AND b.image_url <> ''
GROUP BY j.status ORDER BY j.status;

ROLLBACK;
