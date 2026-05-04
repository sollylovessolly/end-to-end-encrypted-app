import { arrayBufferToBase64, base64ToArrayBuffer } from "./encoding";

const rsaAlgorithm = {
  name: "RSA-OAEP",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};

export async function generateUserKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(rsaAlgorithm, true, ["encrypt", "decrypt"]);
}

export async function exportPublicKey(publicKey: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey("spki", publicKey);
  return arrayBufferToBase64(exported);
}

export async function exportPrivateKey(privateKey: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey("pkcs8", privateKey);
  return arrayBufferToBase64(exported);
}

export async function importPublicKey(publicKeyBase64: string): Promise<CryptoKey> {
  const keyBuffer = base64ToArrayBuffer(publicKeyBase64);

  return crypto.subtle.importKey(
    "spki",
    keyBuffer,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["encrypt"]
  );
}

export async function importPrivateKey(privateKeyBase64: string): Promise<CryptoKey> {
  const keyBuffer = base64ToArrayBuffer(privateKeyBase64);

  return crypto.subtle.importKey(
    "pkcs8",
    keyBuffer,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["decrypt"]
  );
}

async function deriveWrappingKey(password: string, salt: ArrayBuffer) {
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 210_000,
      hash: "SHA-256",
    },
    passwordKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function wrapPrivateKeyWithPassword(
  privateKey: CryptoKey,
  password: string
): Promise<{ wrappedPrivateKey: string; pbkdf2Salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await deriveWrappingKey(password, salt.buffer as ArrayBuffer);
  const exportedPrivateKey = await crypto.subtle.exportKey("pkcs8", privateKey);
  const wrappedPrivateKey = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    wrappingKey,
    exportedPrivateKey
  );

  return {
    wrappedPrivateKey: `${arrayBufferToBase64(iv.buffer as ArrayBuffer)}.${arrayBufferToBase64(
      wrappedPrivateKey
    )}`,
    pbkdf2Salt: arrayBufferToBase64(salt.buffer as ArrayBuffer),
  };
}

export async function unwrapPrivateKeyWithPassword(
  wrappedPrivateKeyBase64: string,
  pbkdf2SaltBase64: string,
  password: string
): Promise<CryptoKey> {
  const [ivBase64, ciphertextBase64] = wrappedPrivateKeyBase64.split(".");

  if (!ivBase64 || !ciphertextBase64) {
    throw new Error("Wrapped private key format is invalid.");
  }

  const wrappingKey = await deriveWrappingKey(
    password,
    base64ToArrayBuffer(pbkdf2SaltBase64)
  );
  const privateKeyBuffer = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToArrayBuffer(ivBase64),
    },
    wrappingKey,
    base64ToArrayBuffer(ciphertextBase64)
  );

  return crypto.subtle.importKey(
    "pkcs8",
    privateKeyBuffer,
    {
      name: "RSA-OAEP",
      hash: "SHA-256",
    },
    true,
    ["decrypt"]
  );
}
