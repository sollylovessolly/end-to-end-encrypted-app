const PRIVATE_KEY_STORAGE_KEY = "whisperbox_private_key";
const PUBLIC_KEY_STORAGE_KEY = "whisperbox_public_key";
const USER_STORAGE_KEY = "whisperbox_user";
const TOKEN_STORAGE_KEY = "whisperbox_token";
const REFRESH_TOKEN_STORAGE_KEY = "whisperbox_refresh_token";

export function savePrivateKey(privateKey: string): void {
  sessionStorage.setItem(PRIVATE_KEY_STORAGE_KEY, privateKey);
}

export function loadPrivateKey(): string | null {
  return sessionStorage.getItem(PRIVATE_KEY_STORAGE_KEY);
}

export function clearPrivateKey(): void {
  sessionStorage.removeItem(PRIVATE_KEY_STORAGE_KEY);
}

export function savePublicKey(publicKey: string): void {
  sessionStorage.setItem(PUBLIC_KEY_STORAGE_KEY, publicKey);
}

export function loadPublicKey(): string | null {
  return sessionStorage.getItem(PUBLIC_KEY_STORAGE_KEY);
}

export function saveSessionUser(user: { id: string; username: string }): void {
  sessionStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

export function loadSessionUser(): { id: string; username: string } | null {
  const user = sessionStorage.getItem(USER_STORAGE_KEY);
  return user ? JSON.parse(user) : null;
}

export function saveToken(token: string): void {
  sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function loadToken(): string | null {
  return sessionStorage.getItem(TOKEN_STORAGE_KEY);
}

export function saveRefreshToken(token: string): void {
  sessionStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, token);
}

export function loadRefreshToken(): string | null {
  return sessionStorage.getItem(REFRESH_TOKEN_STORAGE_KEY);
}

export function clearSession(): void {
  sessionStorage.removeItem(PRIVATE_KEY_STORAGE_KEY);
  sessionStorage.removeItem(PUBLIC_KEY_STORAGE_KEY);
  sessionStorage.removeItem(USER_STORAGE_KEY);
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  sessionStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
}
