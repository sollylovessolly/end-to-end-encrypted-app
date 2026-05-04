import { apiRequest } from "./client";
import type { AuthUser } from "./auth";

export type PublicKeyPayload = {
  public_key: string;
};

export type UserPublicInfo = {
  id: string;
  username: string;
  display_name: string;
};

export type UserPublicKey = UserPublicInfo & {
  public_key: string;
};

export function searchUsers(token: string, query: string) {
  return apiRequest<UserPublicInfo[]>(`/users/search?q=${encodeURIComponent(query)}`, {
    token,
  });
}

export function updateMyPublicKey(token: string, publicKey: string) {
  return apiRequest<AuthUser>("/users/me/public-key", {
    method: "PUT",
    token,
    body: {
      public_key: publicKey,
    } satisfies PublicKeyPayload,
  });
}

export function getUserPublicKey(token: string, userId: string) {
  return apiRequest<UserPublicKey>(`/users/${userId}/public-key`, {
    token,
  });
}
