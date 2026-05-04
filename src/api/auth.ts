import { apiRequest } from "./client";

export type AuthUser = {
  id: string;
  username: string;
  display_name: string;
  public_key: string;
  wrapped_private_key?: string;
  pbkdf2_salt?: string;
  created_at?: string;
};

export type AuthResponse = {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  expires_in: number;
  user: AuthUser;
};

export type LoginPayload = {
  username: string;
  password: string;
};

export type RegisterPayload = {
  username: string;
  display_name: string;
  password: string;
  public_key: string;
  wrapped_private_key: string;
  pbkdf2_salt: string;
};

export function registerUser(payload: RegisterPayload) {
  return apiRequest<AuthResponse>("/auth/register", {
    method: "POST",
    body: payload,
  });
}

export function loginUser(payload: LoginPayload) {
  return apiRequest<AuthResponse>("/auth/login", {
    method: "POST",
    body: payload,
  });
}

export function getCurrentUser(token: string) {
  return apiRequest<AuthUser>("/auth/me", {
    token,
  });
}

export function refreshAccessToken(refreshToken: string) {
  return apiRequest<AuthResponse>("/auth/refresh", {
    method: "POST",
    body: {
      refresh_token: refreshToken,
    },
  });
}

export function logoutUser(token: string, refreshToken: string) {
  return apiRequest<{ ok?: boolean }>("/auth/logout", {
    method: "POST",
    token,
    body: {
      refresh_token: refreshToken,
    },
  });
}
