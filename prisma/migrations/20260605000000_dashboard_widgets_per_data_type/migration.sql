UPDATE "UserPreference"
SET "dashboardWidgets" = jsonb_build_object(
  'bloodSugar', "dashboardWidgets",
  'weight', '["summary","trend","forecast"]'::jsonb
)
WHERE jsonb_typeof("dashboardWidgets"::jsonb) = 'array';
