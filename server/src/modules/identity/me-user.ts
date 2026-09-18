import { UserSchema, z } from "@libiaolink/contracts";
import type { UserRow } from "./user.repository.js";

/** 请求级用户信息（与 /auth/me 的 user 同口径，直接派生自契约）。 */
export type MeUser = z.infer<typeof UserSchema>;

export function toMeUser(user: UserRow): MeUser {
  return {
    id: user.casdoorId,
    name: user.username,
    displayName: user.displayName,
    email: user.email,
    owner: user.owner,
  };
}
