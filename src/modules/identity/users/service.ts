import type { AppPrisma } from "../../../infra/prisma.js";
import type { KeycloakAuthService } from "../auth/keycloak.js";
import { findUserEmailName, findUserName, findUserProfileSummary, updateUserIdentity, upsertProfile } from "./repository.js";
import { serializeProfile } from "./serializer.js";
import type { UpdateProfileInput } from "./schemas.js";

export async function getProfile(prisma: AppPrisma, userId: string) {
  const { user, profile } = await findUserProfileSummary(prisma, userId);
  return serializeProfile(profile, user);
}

export async function updateProfile(prisma: AppPrisma, keycloakAuth: KeycloakAuthService, user: { id: string; keycloakId: string }, body: UpdateProfileInput) {
  const { firstName, lastName, email, ...profileData } = body;
  if (firstName !== undefined || lastName !== undefined || email !== undefined) {
    await keycloakAuth.updateUser({ keycloakId: user.keycloakId, firstName, lastName, email });
    const updateData: { email?: string; name?: string } = {};
    if (email !== undefined) updateData.email = email;
    if (firstName !== undefined || lastName !== undefined) {
      const currentUser = await findUserName(prisma, user.id);
      const [currentFirst, ...rest] = (currentUser.name ?? "").split(" ");
      updateData.name = `${firstName ?? currentFirst} ${lastName ?? rest.join(" ")}`.trim();
    }
    if (Object.keys(updateData).length > 0) await updateUserIdentity(prisma, user.id, updateData);
  }
  const profile = await upsertProfile(prisma, user.id, profileData);
  const savedUser = await findUserEmailName(prisma, user.id);
  return serializeProfile(profile, savedUser);
}
