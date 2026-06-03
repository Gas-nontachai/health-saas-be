# FE Dashboard API Changelog

## 2026-06-03 - Unified health dashboard widgets

`GET /health/dashboard` is now the preferred dashboard API for frontend dashboard screens.

### What Changed

- `GET /health/dashboard` now accepts `widgets` in addition to `range` and `dataTypes`.
- Dashboard widget results are grouped by health data type under `widgets`.
- The response includes `availableDataTypes`, `availableWidgets`, and `defaultWidgets` so FE can render selectable widget controls.
- New canonical preference endpoints are available:
  - `GET /health/dashboard/preferences`
  - `PUT /health/dashboard/preferences`
- User widget preferences are now stored per data type:
  ```json
  {
    "widgets": {
      "bloodSugar": ["summary", "trend", "timeInRange"],
      "weight": ["summary", "trend", "forecast"]
    }
  }
  ```

### Request Examples

Blood sugar dashboard:

```http
GET /health/dashboard?range=7d&dataTypes=bloodSugar&widgets=summary,trend,timeInRange
```

Combined dashboard:

```http
GET /health/dashboard?range=30d&dataTypes=bloodSugar,weight&widgets=summary,trend,forecast
```

Preferences:

```http
GET /health/dashboard/preferences
PUT /health/dashboard/preferences
```

```json
{
  "widgets": {
    "bloodSugar": ["summary", "trend", "timeInRange"],
    "weight": ["summary", "forecast", "goalProgress"]
  }
}
```

### Response Shape

```json
{
  "range": "7d",
  "dataTypes": ["bloodSugar", "weight"],
  "availableDataTypes": ["bloodSugar", "weight"],
  "availableWidgets": {
    "bloodSugar": ["summary", "trend", "timeInRange", "distribution", "dailyPattern", "weeklyAverage", "medAdherence", "medComparison", "loggingStreak", "recentAlerts", "periodComparison"],
    "weight": ["summary", "trend", "forecast", "goalProgress"]
  },
  "defaultWidgets": {
    "bloodSugar": ["summary", "trend", "timeInRange", "distribution", "dailyPattern", "medAdherence", "recentAlerts"],
    "weight": ["summary", "trend", "forecast"]
  },
  "widgets": {
    "bloodSugar": {
      "summary": { "status": "ok", "data": { "avg": 160, "min": 120, "max": 200, "count": 2 } },
      "trend": { "status": "ok", "data": [{ "datetime": "2026-06-01T08:00:00.000Z", "value": 120 }] }
    },
    "weight": {
      "summary": { "status": "ok", "data": { "currentValue": 148, "lowestValue": 148, "highestValue": 150 } },
      "forecast": { "status": "ok", "data": { "status": "ahead", "cards": {}, "series": {} } }
    }
  }
}
```

Every widget result uses:

```json
{ "status": "ok", "message": "optional", "data": {} }
```

or:

```json
{ "status": "insufficient_data", "message": "reason", "data": null }
```

### Widget Keys

Blood sugar:

- `summary`
- `trend`
- `timeInRange`
- `distribution`
- `dailyPattern`
- `weeklyAverage`
- `medAdherence`
- `medComparison`
- `loggingStreak`
- `recentAlerts`
- `periodComparison`

Weight:

- `summary`
- `trend`
- `forecast`
- `goalProgress`

### Validation Notes

- `widgets` is comma-separated.
- If `widgets` is omitted, BE uses defaults per selected data type.
- If a widget is supported by at least one selected data type, it is applied only to matching data types.
- If a widget is unsupported by every selected data type, BE returns `400`.
- Example invalid request:
  ```http
  GET /health/dashboard?dataTypes=bloodSugar&widgets=forecast
  ```

### Migration Notes For FE

- Prefer `GET /health/dashboard` over legacy `GET /dashboard`.
- Prefer `GET /health/dashboard` over `/health/blood-sugar/dashboard` for dashboard screens.
- `/health/blood-sugar/dashboard` remains a simple/raw compatibility endpoint.
- `/dashboard/preferences` remains legacy flat `{ "widgets": [...] }`; new FE should use `/health/dashboard/preferences`.
- FE should use `availableWidgets` and `defaultWidgets` from the response to drive checkbox/toggle availability.
