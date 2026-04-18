-- Idempotent: add `content` when DB skipped migration 0002 (fixes ER_BAD_FIELD_ERROR Unknown column 'content')
SET @__law_add_content := (
  SELECT IF(
    (
      SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'change_logs'
        AND COLUMN_NAME = 'content'
    ) = 0,
    'ALTER TABLE `change_logs` ADD COLUMN `content` longtext',
    'SELECT 1'
  )
);
PREPARE __law_stmt FROM @__law_add_content;
EXECUTE __law_stmt;
DEALLOCATE PREPARE __law_stmt;
