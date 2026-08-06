# Frontend Handoff: HttpOnly Refresh Token Integration

## Objective

Frontend must stop reading or storing refresh tokens. The backend stores the refresh credential in an HttpOnly cookie, while the access token remains a short-lived Bearer JWT returned in JSON.

## Backend contract

- Access token lifetime: 900 seconds
- Refresh session lifetime: 30 days, rotated on every refresh
- Refresh cookie: `refresh_token`
- Cookie path: `/auth`
- Production cookie: `HttpOnly; Secure; SameSite=None`
- Development cookie: `HttpOnly; SameSite=Lax`
- `expires_in` is expressed in seconds
- Allowed origins:
  - `http://localhost:5173`
  - `https://health-saas-one.vercel.app`
  - `https://health-saas-dev.vercel.app`

## Required frontend changes

1. Remove refresh-token reads/writes from `localStorage`, `sessionStorage`, application state, and logs.
2. Send `X-Auth-Contract: cookie-v1` on register, login, and refresh.
3. Send `credentials: "include"` on register, login, refresh, and logout.
4. Keep the access token in memory where possible. Continue sending it as `Authorization: Bearer <access_token>` to protected APIs.
5. On a protected API `401`, run a single shared refresh request, replace the access token, and retry the original request once.
6. If refresh returns `401`, clear the local access token and redirect to login. Never retry refresh recursively.

## API requests

### Login

```ts
const response = await fetch(`${API_URL}/auth/login`, {
  method: "POST",
  credentials: "include",
  headers: {
    "Content-Type": "application/json",
    "X-Auth-Contract": "cookie-v1",
  },
  body: JSON.stringify({ email, password }),
});
```

Successful JSON response:

```json
{
  "access_token": "eyJ...",
  "expires_in": 900,
  "token_type": "Bearer",
  "requiresPasswordChange": false,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "User",
    "roles": ["User"],
    "permissions": ["auth.read.self"]
  }
}
```

There is no `refresh_token` property in cookie-v1 JSON. The browser accepts the refresh cookie through `Set-Cookie`; JavaScript cannot read it through `document.cookie`.

Registration uses the same headers and credentials behavior with `POST /auth/register`.

### Refresh and restore after page reload

```ts
const response = await fetch(`${API_URL}/auth/refresh`, {
  method: "POST",
  credentials: "include",
  headers: {
    "X-Auth-Contract": "cookie-v1",
  },
});
```

- Do not send a request body.
- On success, replace the access token with `response.access_token`.
- Call this endpoint once during SPA initialization to restore a session after reload.
- A successful refresh rotates the cookie automatically.
- `401` means the cookie is missing, expired, revoked, or reused; treat the user as signed out.
- `403` means the deployed frontend origin is missing from the backend allowlist.

### Logout

```ts
await fetch(`${API_URL}/auth/logout`, {
  method: "POST",
  credentials: "include",
});
```

Always clear the local access token after the request. Logout returns `200` even when the session has already expired or does not exist.

## Suggested refresh/retry behavior

Use one shared in-flight refresh promise so concurrent `401` responses do not send the same one-time refresh token more than once:

```ts
let accessToken: string | null = null;
let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "X-Auth-Contract": "cookie-v1" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("SESSION_EXPIRED");
        const body = await response.json();
        accessToken = body.access_token;
        return body.access_token;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}
```

The API wrapper should retry an original request at most once. Exclude `/auth/login`, `/auth/register`, `/auth/refresh`, and `/auth/logout` from automatic refresh interception.

## Error format

```json
{
  "ok": false,
  "error": "message"
}
```

Relevant statuses:

- `400`: invalid request payload
- `401`: invalid login or unavailable refresh session
- `403`: origin rejected, permission denied, or password change required
- `409`: user already exists
- `429`: rate limited

If `requiresPasswordChange` is true, preserve the existing forced-password-change behavior.

## Rollout

The backend currently keeps `AUTH_LEGACY_JSON_REFRESH_ENABLED=true` by default. Existing frontend versions can continue using the legacy JSON contract temporarily. The new frontend must explicitly send `X-Auth-Contract: cookie-v1`.

After the new frontend is deployed and verified in both Vercel environments, backend operations will set `AUTH_LEGACY_JSON_REFRESH_ENABLED=false`. At that point, JSON refresh-token input/output stops working completely.

## Integration acceptance checklist

- Login response does not contain `refresh_token`.
- Browser storage contains no refresh token.
- The refresh cookie appears under browser DevTools with HttpOnly enabled.
- Reload restores the session through `POST /auth/refresh`.
- An expired access token triggers one refresh and one request retry.
- Multiple concurrent `401` responses produce only one refresh request.
- Logout clears the session; refresh after logout returns `401`.
- Requests work from both approved Vercel origins.
- No access token, refresh token, or Cookie header is written to frontend logs or analytics.
