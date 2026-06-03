# Workspace Instructions

## API Contract Changes

* When dashboard API behavior changes, update both `API_SPEC.md` and `API_CHANGELOG.md`.

* These documents are the source of truth for frontend integration and must be kept in sync with the implementation.

* Do not merge API contract changes without updating the corresponding documentation.

* Any endpoint or response intended to return large datasets must support scroll fetch via pagination, preferably cursor-based pagination compatible with infinite scroll.

* Check the DB preference shape together with the API response shape; do not update only the route/service layer.

* Preserve backward compatibility for existing widget preferences stored as legacy arrays.

## Documentation Requirements

* `API_SPEC.md` must describe the latest API behavior, request payloads, response payloads, validation rules, and examples.

* For endpoints that support large list retrieval, `API_SPEC.md` and `API_CHANGELOG.md` must explicitly document the scroll-fetch contract, including pagination parameters and next-page response fields.

* `API_CHANGELOG.md` must clearly describe:

  * What changed
  * Why it changed
  * Whether the change is breaking or non-breaking
  * Any frontend actions required
  * Any migration or compatibility notes

* Documentation should provide sufficient information for frontend implementation without requiring code inspection.

## Testing Requirements

* Add or update tests for:

  * Service behavior
  * Route validation
  * Legacy compatibility
  * Migration/backfill behavior
