import type { User, UserInternal } from "@/types"

/**
 * Converts internal UserInternal type (with passwordHash) to public User type (without passwordHash)
 * Used for safe serialization of user data in API responses
 */
export function toPublicUser(user: UserInternal): User {
  const { passwordHash, ...publicUser } = user
  return publicUser
}

