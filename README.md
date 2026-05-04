# WhisperBox E2EE

A Telegram-inspired secure messaging frontend for the Stage 4B End-to-End Encrypted App task.

The app demonstrates the core E2EE rule: messages are encrypted in the browser before they are sent anywhere. The backend should only receive ciphertext, an IV, and an encrypted message key.

## Tech Stack

- React
- TypeScript
- Vite
- Tailwind CSS
- Web Crypto API
- PBKDF2 + AES-GCM private key wrapping
- Session storage for the unlocked private key during the active browser session
- WhisperBox API base URL: `https://whisperbox.koyeb.app`

## Run Locally

```bash
npm install
npm run dev
```

Build for deployment:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Architecture

```txt
Sender Browser
  - user types plaintext
  - browser creates fresh AES-GCM key
  - browser encrypts message
  - browser encrypts AES key with recipient public RSA-OAEP key
        |
        v
Backend / API
  - stores sender id
  - stores recipient id
  - stores ciphertext
  - stores IV
  - stores encrypted AES key
  - never receives plaintext or private keys
        |
        v
Recipient Browser
  - downloads encrypted payload
  - decrypts AES key with local private key
  - decrypts message with AES-GCM
  - shows plaintext only in the UI
```

## Encryption Flow

This project uses hybrid encryption:

1. A fresh AES-GCM key is generated for each message.
2. The plaintext message is encrypted with AES-GCM.
3. The AES key is exported as raw key material.
4. The raw AES key is encrypted with the recipient's RSA-OAEP public key.
5. The app sends only `ciphertext`, `iv`, and `encryptedKey`.
6. The recipient uses their RSA-OAEP private key to decrypt the AES key.
7. The decrypted AES key decrypts the message locally.

Short interview answer:

> AES-GCM encrypts the actual message. RSA-OAEP encrypts the AES message key.

## Key Management

Each user has:

- Public key: safe to share and suitable for backend storage.
- Private key: secret and kept on the client.

The app generates keys with `crypto.subtle.generateKey()` using RSA-OAEP and SHA-256.

During registration:

1. The browser generates the RSA-OAEP key pair.
2. The public key is sent to the backend.
3. The private key is encrypted locally with AES-GCM.
4. The AES-GCM key is derived from the user's password using PBKDF2 and a random salt.
5. The backend stores only `public_key`, `wrapped_private_key`, and `pbkdf2_salt`.

During login:

1. The backend returns `wrapped_private_key` and `pbkdf2_salt`.
2. The browser re-derives the AES-GCM key from the password.
3. The browser decrypts and imports the RSA private key locally.
4. The unlocked private key is kept only for the active browser session.

## API Boundary

The API layer is separated from the crypto layer:

- `src/crypto/*` handles key generation, encryption, decryption, and encoding.
- `src/api/*` handles backend requests.
- `src/pages/ChatPage.tsx` connects UI actions to crypto and API-ready payloads.

The API should never receive:

- Plaintext messages
- Private keys
- Raw AES keys

The API may receive:

- User identity metadata
- Public keys
- Ciphertext
- IV values
- Encrypted AES keys

## Security Notes

- The server cannot decrypt message content without the recipient private key.
- AES-GCM provides authenticated encryption, so tampered ciphertext fails decryption.
- RSA-OAEP is used to protect the per-message AES key.
- HTTPS is required for production transport security.
- Decryption failures are handled with a clear UI message.

## Known Limitations

- This is an educational E2EE implementation, not a full Signal protocol clone.
- The MVP does not implement Double Ratchet or full forward secrecy.
- Backend metadata such as sender, recipient, and timestamps may still be visible.
- If a user's private key is lost, old messages cannot be decrypted.
- If a device is compromised, local key material may be exposed.
- Private-key storage should be upgraded to passphrase-encrypted IndexedDB for production.

## Deployment

This is a static Vite app. It can be deployed to Vercel, Netlify, GitHub Pages, or any static host.

Typical build settings:

```txt
Build command: npm run build
Output directory: dist
```
