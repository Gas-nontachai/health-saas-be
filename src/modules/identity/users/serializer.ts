export function serializeProfile(profile: unknown, user: { email: string; name: string | null }) { return { ...(profile as object), email: user.email, name: user.name }; }
