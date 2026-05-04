import type { AppConfig } from "../config.js";
import { HttpError } from "../shared/errors.js";

export type KeycloakTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_expires_in?: number;
  refresh_token?: string;
  token_type: string;
  id_token?: string;
  "not-before-policy"?: number;
  session_state?: string;
  scope?: string;
};

export type RegisterInput = {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type ResetPasswordInput = {
  keycloakId: string;
  email: string;
  currentPassword: string;
  newPassword: string;
};

export type KeycloakUser = {
  id: string;
  email?: string;
  username?: string;
};

export type KeycloakAuthService = {
  register(input: RegisterInput): Promise<KeycloakTokenResponse>;
  login(input: LoginInput): Promise<KeycloakTokenResponse>;
  resetPassword(input: ResetPasswordInput): Promise<void>;
  findUserByEmail(email: string): Promise<KeycloakUser | null>;
  setPassword(keycloakId: string, newPassword: string): Promise<void>;
};

export function createKeycloakAuthService(config: AppConfig): KeycloakAuthService {
  return {
    async register(input) {
      const adminToken = await getAdminToken(config);
      await createKeycloakUser(config, adminToken, input);
      return getUserToken(config, input);
    },
    async login(input) {
      return getUserToken(config, input);
    },
    async resetPassword(input) {
      await getUserToken(config, { email: input.email, password: input.currentPassword });
      const adminToken = await getAdminToken(config);
      await resetKeycloakPassword(config, adminToken, input.keycloakId, input.newPassword);
    },
    async findUserByEmail(email) {
      const adminToken = await getAdminToken(config);
      return findKeycloakUserByEmail(config, adminToken, email);
    },
    async setPassword(keycloakId, newPassword) {
      const adminToken = await getAdminToken(config);
      await resetKeycloakPassword(config, adminToken, keycloakId, newPassword);
    }
  };
}

async function getAdminToken(config: AppConfig): Promise<string> {
  const body = new URLSearchParams({
    client_id: "admin-cli",
    grant_type: "password",
    username: config.KEYCLOAK_ADMIN_USERNAME,
    password: config.KEYCLOAK_ADMIN_PASSWORD
  });

  const response = await fetch(`${config.KEYCLOAK_BASE_URL}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });

  const data = await parseKeycloakResponse<{ access_token?: string }>(response);
  if (!data.access_token) {
    throw new HttpError(502, "Keycloak admin token response is missing access token");
  }

  return data.access_token;
}

async function createKeycloakUser(config: AppConfig, adminToken: string, input: RegisterInput): Promise<void> {
  const response = await fetch(`${config.KEYCLOAK_BASE_URL}/admin/realms/${encodeURIComponent(config.KEYCLOAK_REALM)}/users`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      username: input.email,
      email: input.email,
      enabled: true,
      emailVerified: true,
      firstName: input.firstName ?? "",
      lastName: input.lastName ?? "",
      credentials: [
        {
          type: "password",
          value: input.password,
          temporary: false
        }
      ]
    })
  });

  if (response.status === 409) {
    throw new HttpError(409, "User already exists");
  }

  if (!response.ok) {
    const message = await readKeycloakError(response);
    throw new HttpError(response.status, message);
  }
}

async function findKeycloakUserByEmail(config: AppConfig, adminToken: string, email: string): Promise<KeycloakUser | null> {
  const url = new URL(`${config.KEYCLOAK_BASE_URL}/admin/realms/${encodeURIComponent(config.KEYCLOAK_REALM)}/users`);
  url.searchParams.set("email", email);
  url.searchParams.set("exact", "true");
  url.searchParams.set("max", "2");

  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${adminToken}`
    }
  });

  const users = await parseKeycloakResponse<KeycloakUser[]>(response);
  return users.find((user) => user.email?.toLowerCase() === email.toLowerCase() || user.username?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function resetKeycloakPassword(config: AppConfig, adminToken: string, keycloakId: string, newPassword: string): Promise<void> {
  const response = await fetch(
    `${config.KEYCLOAK_BASE_URL}/admin/realms/${encodeURIComponent(config.KEYCLOAK_REALM)}/users/${encodeURIComponent(keycloakId)}/reset-password`,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${adminToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        type: "password",
        value: newPassword,
        temporary: false
      })
    }
  );

  if (!response.ok) {
    const message = await readKeycloakError(response);
    throw new HttpError(response.status, message);
  }
}

async function getUserToken(config: AppConfig, input: LoginInput): Promise<KeycloakTokenResponse> {
  const body = new URLSearchParams({
    client_id: config.KEYCLOAK_CLIENT_ID,
    grant_type: "password",
    username: input.email,
    password: input.password
  });

  if (config.KEYCLOAK_CLIENT_SECRET) {
    body.set("client_secret", config.KEYCLOAK_CLIENT_SECRET);
  }

  const response = await fetch(
    `${config.KEYCLOAK_BASE_URL}/realms/${encodeURIComponent(config.KEYCLOAK_REALM)}/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    }
  );

  if (response.status === 400 || response.status === 401) {
    throw new HttpError(401, "Invalid email or password");
  }

  return parseKeycloakResponse<KeycloakTokenResponse>(response);
}

async function parseKeycloakResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const message = await readKeycloakError(response);
    throw new HttpError(response.status, message);
  }

  return (await response.json()) as T;
}

async function readKeycloakError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error_description?: string; errorMessage?: string; error?: string };
    return data.error_description ?? data.errorMessage ?? data.error ?? "Keycloak request failed";
  } catch {
    return "Keycloak request failed";
  }
}
