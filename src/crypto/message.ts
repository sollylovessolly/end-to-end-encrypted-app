import {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  bytesToText,
  textToBytes,
} from "./encoding";

export type EncryptedMessagePayload = {
  ciphertext: string;
  iv: string;
  encryptedKey: string;
  encryptedKeyForSelf?: string;
};

export async function encryptMessage(
  plainText: string,
  recipientPublicKey: CryptoKey,
  senderPublicKey?: CryptoKey
): Promise<EncryptedMessagePayload> {
  const aesKey = await crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    aesKey,
    textToBytes(plainText)
  );

  const rawAesKey = await crypto.subtle.exportKey("raw", aesKey);

  const encryptedKey = await crypto.subtle.encrypt(
    {
      name: "RSA-OAEP",
    },
    recipientPublicKey,
    rawAesKey
  );

  const encryptedKeyForSelf = senderPublicKey
    ? await crypto.subtle.encrypt(
        {
          name: "RSA-OAEP",
        },
        senderPublicKey,
        rawAesKey
      )
    : null;

  return {
    ciphertext: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv.buffer),
    encryptedKey: arrayBufferToBase64(encryptedKey),
    ...(encryptedKeyForSelf
      ? { encryptedKeyForSelf: arrayBufferToBase64(encryptedKeyForSelf) }
      : {}),
  };
}

export async function decryptMessage(
  payload: EncryptedMessagePayload,
  privateKey: CryptoKey,
  useSelfKey = false
): Promise<string> {
  const encryptedKey = useSelfKey
    ? payload.encryptedKeyForSelf ?? payload.encryptedKey
    : payload.encryptedKey;

  const decryptedAesKey = await crypto.subtle.decrypt(
    {
      name: "RSA-OAEP",
    },
    privateKey,
    base64ToArrayBuffer(encryptedKey)
  );

  const aesKey = await crypto.subtle.importKey(
    "raw",
    decryptedAesKey,
    {
      name: "AES-GCM",
    },
    false,
    ["decrypt"]
  );

  const plainBuffer = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToArrayBuffer(payload.iv),
    },
    aesKey,
    base64ToArrayBuffer(payload.ciphertext)
  );

  return bytesToText(plainBuffer);
}
