import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  CheckCheck,
  KeyRound,
  Lock,
  LogOut,
  MessageCircle,
  Search,
  Send,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import {
  exportPrivateKey,
  exportPublicKey,
  generateUserKeyPair,
  importPrivateKey,
  importPublicKey,
  unwrapPrivateKeyWithPassword,
  wrapPrivateKeyWithPassword,
} from "../crypto/keys";
import {
  decryptMessage,
  encryptMessage,
  type EncryptedMessagePayload,
} from "../crypto/message";
import {
  clearSession,
  loadPrivateKey,
  loadPublicKey,
  loadRefreshToken,
  loadSessionUser,
  loadToken,
  savePrivateKey,
  savePublicKey,
  saveRefreshToken,
  saveSessionUser,
  saveToken,
} from "../crypto/storage";
import { loginUser, logoutUser, registerUser } from "../api/auth";
import { getUserPublicKey, searchUsers } from "../api/users";
import {
  getMessagesWithUser,
  listConversations,
  sendEncryptedMessageToApi,
} from "../api/messages";

type SessionUser = {
  id: string;
  username: string;
  displayName?: string;
};

type Contact = {
  id: string;
  username: string;
  title: string;
  publicKey: string;
  privateKey?: string;
  lastSeen: string;
  isRemote?: boolean;
};

type ChatMessage = {
  id: string;
  contactId: string;
  senderId: string;
  recipientId: string;
  encrypted: EncryptedMessagePayload;
  plaintext?: string;
  createdAt: string;
  status: "encrypted" | "decrypted" | "failed";
};

const cannedReplies = [
  "Received. This reply was encrypted for your public key.",
  "Notice how the server-shaped payload still contains no plaintext.",
  "If your private key is missing, this message cannot be decrypted.",
  "AES-GCM handled the text; RSA-OAEP protected the AES key.",
];

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function ChatPage() {
  const [user, setUser] = useState<SessionUser | null>(() => loadSessionUser());
  const [token, setToken] = useState<string | null>(() => loadToken());
  const [publicKey, setPublicKey] = useState<string | null>(() => loadPublicKey());
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [usernameInput, setUsernameInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [authMode, setAuthMode] = useState<"register" | "login">("register");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Private key is kept in this browser session.");
  const [isStarting, setIsStarting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  const selectedContact = contacts.find((contact) => contact.id === selectedContactId);

  const visibleContacts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return contacts;
    }

    return contacts.filter((contact) =>
      `${contact.username} ${contact.title}`.toLowerCase().includes(query)
    );
  }, [contacts, search]);

  const activeMessages = useMemo(() => {
    return messages
      .filter((message) => message.contactId === selectedContactId)
      .sort(
        (first, second) =>
          new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime()
      );
  }, [messages, selectedContactId]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeMessages.length]);

  useEffect(() => {
    if (token && contacts.length === 0) {
      void loadRemoteConversations(token);
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadRemoteConversations(token);
    }, 8000);

    return () => window.clearInterval(intervalId);
  }, [token]);

  useEffect(() => {
    if (!token || !selectedContact?.isRemote) {
      return;
    }

    void loadRemoteMessages(selectedContact);

    const intervalId = window.setInterval(() => {
      void loadRemoteMessages(selectedContact);
    }, 4000);

    return () => window.clearInterval(intervalId);
  }, [token, selectedContactId]);

  useEffect(() => {
    const query = search.trim();
    if (!token || query.length < 1) {
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        const users = await searchUsers(token, query);
        setContacts((current) => {
          const existing = new Map(current.map((contact) => [contact.id, contact]));
          users.forEach((remoteUser) => {
            existing.set(remoteUser.id, {
              ...existing.get(remoteUser.id),
              id: remoteUser.id,
              username: remoteUser.username,
              title: remoteUser.display_name,
              publicKey: existing.get(remoteUser.id)?.publicKey ?? "",
              lastSeen: "remote user",
              isRemote: true,
            });
          });
          return Array.from(existing.values());
        });
        setStatus(
          users.length > 0
            ? "Search results loaded from WhisperBox."
            : "No user found. The other person must register first."
        );
      } catch (error) {
        console.warn(error);
        setStatus("User search failed. Confirm the backend is reachable.");
      }
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [search, token]);

  async function startSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const username = usernameInput.trim();
    if (!username || passwordInput.length < 8) {
      setStatus("Use a username and a password with at least 8 characters.");
      return;
    }

    setIsStarting(true);
    setStatus(
      authMode === "register"
        ? "Generating your RSA-OAEP key pair and wrapping the private key..."
        : "Logging in and unwrapping your private key locally..."
    );

    try {
      if (authMode === "register") {
        const keyPair = await generateUserKeyPair();
        const exportedPublicKey = await exportPublicKey(keyPair.publicKey);
        const exportedPrivateKey = await exportPrivateKey(keyPair.privateKey);
        const wrapped = await wrapPrivateKeyWithPassword(
          keyPair.privateKey,
          passwordInput
        );
        const response = await registerUser({
          username,
          display_name: username,
          password: passwordInput,
          public_key: exportedPublicKey,
          wrapped_private_key: wrapped.wrappedPrivateKey,
          pbkdf2_salt: wrapped.pbkdf2Salt,
        });
        const nextUser = {
          id: response.user.id,
          username: response.user.username,
          displayName: response.user.display_name,
        };

        saveSessionUser(nextUser);
        saveToken(response.access_token);
        saveRefreshToken(response.refresh_token);
        savePublicKey(response.user.public_key);
        savePrivateKey(exportedPrivateKey);

        setUser(nextUser);
        setToken(response.access_token);
        setPublicKey(response.user.public_key);
        setStatus("Registered. Public key uploaded; private key stayed local.");
        await loadRemoteConversations(response.access_token);
        return;
      }

      const response = await loginUser({
        username,
        password: passwordInput,
      });

      if (!response.user.wrapped_private_key || !response.user.pbkdf2_salt) {
        throw new Error("Login response did not include wrapped key material.");
      }

      const privateKey = await unwrapPrivateKeyWithPassword(
        response.user.wrapped_private_key,
        response.user.pbkdf2_salt,
        passwordInput
      );
      const exportedPrivateKey = await exportPrivateKey(privateKey);
      const nextUser = {
        id: response.user.id,
        username: response.user.username,
        displayName: response.user.display_name,
      };

      saveSessionUser(nextUser);
      saveToken(response.access_token);
      saveRefreshToken(response.refresh_token);
      savePublicKey(response.user.public_key);
      savePrivateKey(exportedPrivateKey);

      setUser(nextUser);
      setToken(response.access_token);
      setPublicKey(response.user.public_key);
      setStatus("Logged in. Private key was unwrapped locally from your password.");
      await loadRemoteConversations(response.access_token);
    } catch (error) {
      console.error(error);
      setStatus(
        error instanceof Error
          ? `Backend auth failed: ${error.message}`
          : "Backend auth failed. Check username/password or try another username."
      );
    } finally {
      setIsStarting(false);
    }
  }

  async function loadRemoteConversations(accessToken: string) {
    try {
      const conversations = await listConversations(accessToken);
      setContacts((current) => {
        const existing = new Map(current.map((contact) => [contact.id, contact]));
        conversations.forEach((conversation) => {
          existing.set(conversation.user_id, {
            ...existing.get(conversation.user_id),
            id: conversation.user_id,
            username: conversation.username,
            title: conversation.display_name,
            publicKey: existing.get(conversation.user_id)?.publicKey ?? "",
            lastSeen: conversation.last_message_at
              ? formatTime(conversation.last_message_at)
              : "recent",
            isRemote: true,
          });
        });

        const nextContacts = Array.from(existing.values());
        if (!selectedContactId && nextContacts[0]) {
          setSelectedContactId(nextContacts[0].id);
        }
        return nextContacts;
      });
    } catch (error) {
      console.warn(error);
      setStatus("No remote conversations yet. Search for a user to start one.");
    }
  }

  async function loadRemoteMessages(contact: Contact) {
    if (!token || !user) {
      return;
    }

    try {
      const privateKeyString = loadPrivateKey();
      if (!privateKeyString) {
        throw new Error("Missing private key");
      }

      const privateKey = await importPrivateKey(privateKeyString);
      const remoteMessages = await getMessagesWithUser(token, contact.id);
      const decryptedMessages = await Promise.all(
        remoteMessages.map(async (message) => {
          const isMine = message.from_user_id === user.id;
          try {
            return {
              id: message.id,
              contactId: contact.id,
              senderId: message.from_user_id,
              recipientId: message.to_user_id,
              encrypted: message.payload,
              plaintext: await decryptMessage(message.payload, privateKey, isMine),
              createdAt: message.created_at,
              status: "decrypted" as const,
            };
          } catch {
            return {
              id: message.id,
              contactId: contact.id,
              senderId: message.from_user_id,
              recipientId: message.to_user_id,
              encrypted: message.payload,
              createdAt: message.created_at,
              status: "failed" as const,
            };
          }
        })
      );

      setMessages((current) => [
        ...current.filter((message) => message.contactId !== contact.id),
        ...decryptedMessages,
      ]);
      setStatus("Conversation history loaded and decrypted locally.");
    } catch (error) {
      console.warn(error);
      setStatus("Could not load remote conversation history.");
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!user || !token || !selectedContact || !draft.trim()) {
      return;
    }

    setIsSending(true);
    setStatus(`Encrypting message for ${selectedContact.username} before send...`);

    try {
      let contactPublicKey = selectedContact.publicKey;
      if (!contactPublicKey && token) {
        const keyResponse = await getUserPublicKey(token, selectedContact.id);
        contactPublicKey = keyResponse.public_key;
        setContacts((current) =>
          current.map((contact) =>
            contact.id === selectedContact.id
              ? { ...contact, publicKey: keyResponse.public_key }
              : contact
          )
        );
      }

      if (!contactPublicKey || !publicKey) {
        throw new Error("Missing public key");
      }

      const recipientPublicKey = await importPublicKey(contactPublicKey);
      const senderPublicKey = await importPublicKey(publicKey);
      const encrypted = await encryptMessage(
        draft.trim(),
        recipientPublicKey,
        senderPublicKey
      );
      const createdAt = new Date().toISOString();
      const localDraft = draft.trim();

      setMessages((current) => [
        ...current,
        {
          id: createId("msg"),
          contactId: selectedContact.id,
          senderId: user.id,
          recipientId: selectedContact.id,
          encrypted,
          plaintext: localDraft,
          createdAt,
          status: "encrypted",
        },
      ]);

      setDraft("");
      setStatus("Sending ciphertext payload to WhisperBox backend...");

      if (token && selectedContact.isRemote) {
        await sendEncryptedMessageToApi(token, selectedContact.id, encrypted);
        setStatus("Encrypted message sent. Backend received no plaintext.");
        return;
      }

      window.setTimeout(() => {
        void createEncryptedReply(selectedContact);
      }, 700);
    } catch (error) {
      console.error(error);
      setStatus("Encryption failed. Check the recipient public key.");
    } finally {
      setIsSending(false);
    }
  }

  async function createEncryptedReply(contact: Contact) {
    if (!user || !publicKey) {
      return;
    }

    try {
      const myPublicKey = await importPublicKey(publicKey);
      const reply = cannedReplies[Math.floor(Math.random() * cannedReplies.length)];
      const encrypted = await encryptMessage(reply, myPublicKey);
      const privateKeyString = loadPrivateKey();

      if (!privateKeyString) {
        throw new Error("Missing local private key");
      }

      const myPrivateKey = await importPrivateKey(privateKeyString);
      const plaintext = await decryptMessage(encrypted, myPrivateKey);

      setMessages((current) => [
        ...current,
        {
          id: createId("msg"),
          contactId: contact.id,
          senderId: contact.id,
          recipientId: user.id,
          encrypted,
          plaintext,
          createdAt: new Date().toISOString(),
          status: "decrypted",
        },
      ]);
      setStatus("Incoming ciphertext decrypted locally with your private key.");
    } catch (error) {
      console.error(error);
      setMessages((current) => [
        ...current,
        {
          id: createId("msg"),
          contactId: contact.id,
          senderId: contact.id,
          recipientId: user?.id ?? "me",
          encrypted: {
            ciphertext: "unreadable",
            iv: "missing",
            encryptedKey: "missing",
          },
          createdAt: new Date().toISOString(),
          status: "failed",
        },
      ]);
      setStatus("Could not decrypt incoming message because the local private key was unavailable.");
    }
  }

  function logout() {
    const refreshToken = loadRefreshToken();
    if (token && refreshToken) {
      void logoutUser(token, refreshToken).catch(() => undefined);
    }
    clearSession();
    setUser(null);
    setToken(null);
    setPublicKey(null);
    setContacts([]);
    setMessages([]);
    setSelectedContactId(null);
    setDraft("");
    setStatus("Logged out. Local session keys were cleared.");
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-50">
        <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-5 py-10 lg:grid-cols-[1fr_420px]">
          <section>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-200">
              <Lock size={16} />
              Client-side encryption first
            </div>
            <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-6xl">
              WhisperBox
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-zinc-300">
              A Telegram-inspired secure messaging demo. Messages are encrypted
              in the browser with AES-GCM, while RSA-OAEP protects each message key.
            </p>

            <div className="mt-8 grid max-w-3xl gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                <KeyRound className="text-emerald-300" size={22} />
                <p className="mt-3 font-medium">Public key shared</p>
                <p className="mt-1 text-sm text-zinc-400">Backend may store this.</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                <ShieldCheck className="text-emerald-300" size={22} />
                <p className="mt-3 font-medium">Private key local</p>
                <p className="mt-1 text-sm text-zinc-400">Never sent to server.</p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
                <MessageCircle className="text-emerald-300" size={22} />
                <p className="mt-3 font-medium">Ciphertext stored</p>
                <p className="mt-1 text-sm text-zinc-400">No plaintext backend.</p>
              </div>
            </div>
          </section>

          <form
            onSubmit={startSession}
            className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-2xl shadow-emerald-950/20"
          >
            <div className="mb-6">
              <h2 className="text-2xl font-semibold">Start secure session</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-400">
                This creates demo auth plus a real browser-generated encryption key pair.
              </p>
            </div>

            <label className="block text-sm font-medium text-zinc-300">
              Username
              <input
                value={usernameInput}
                onChange={(event) => setUsernameInput(event.target.value)}
                className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-zinc-100 outline-none transition focus:border-emerald-400"
                placeholder="e.g. favour"
              />
            </label>

            <label className="mt-4 block text-sm font-medium text-zinc-300">
              Password
              <input
                value={passwordInput}
                onChange={(event) => setPasswordInput(event.target.value)}
                className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-zinc-100 outline-none transition focus:border-emerald-400"
                placeholder="demo password"
                type="password"
              />
            </label>

            <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-zinc-950 p-1">
              <button
                type="button"
                onClick={() => setAuthMode("register")}
                className={`rounded-md px-3 py-2 text-sm font-medium ${
                  authMode === "register"
                    ? "bg-emerald-400 text-zinc-950"
                    : "text-zinc-400"
                }`}
              >
                Register
              </button>
              <button
                type="button"
                onClick={() => setAuthMode("login")}
                className={`rounded-md px-3 py-2 text-sm font-medium ${
                  authMode === "login"
                    ? "bg-emerald-400 text-zinc-950"
                    : "text-zinc-400"
                }`}
              >
                Login
              </button>
            </div>

            <button
              disabled={isStarting}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-400 px-4 py-3 font-semibold text-zinc-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Lock size={18} />
              {isStarting
                ? "Working..."
                : authMode === "register"
                  ? "Create encrypted account"
                  : "Login and unlock key"}
            </button>

            <p className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm leading-6 text-zinc-400">
              {status}
            </p>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="grid min-h-screen lg:grid-cols-[340px_1fr]">
        <aside className="border-r border-zinc-800 bg-zinc-900">
          <div className="border-b border-zinc-800 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-400 font-bold text-zinc-950">
                  {user.username.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold">{user.username}</p>
                  <p className="text-xs text-emerald-300">private key local</p>
                </div>
              </div>
              <button
                onClick={logout}
                className="rounded-lg p-2 text-zinc-400 transition hover:bg-zinc-800 hover:text-white"
                title="Log out"
              >
                <LogOut size={18} />
              </button>
            </div>

            <div className="mt-4 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2">
              <Search size={17} className="text-zinc-500" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full bg-transparent text-sm outline-none placeholder:text-zinc-500"
                placeholder="Search chats"
              />
            </div>
          </div>

          <div className="p-2">
            {contacts.length === 0 ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm leading-6 text-zinc-400">
                <p className="font-medium text-zinc-200">No chats yet</p>
                <p className="mt-2">
                  Search for another registered username to start an encrypted
                  conversation.
                </p>
              </div>
            ) : null}

            {contacts.length > 0 && visibleContacts.length === 0 ? (
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm leading-6 text-zinc-400">
                No matching chats. Keep typing to search registered users.
              </div>
            ) : null}

            {visibleContacts.map((contact) => (
              <button
                key={contact.id}
                onClick={() => {
                  setSelectedContactId(contact.id);
                  if (contact.isRemote) {
                    void loadRemoteMessages(contact);
                  }
                }}
                className={`flex w-full items-center gap-3 rounded-lg p-3 text-left transition ${
                  selectedContactId === contact.id
                    ? "bg-emerald-400 text-zinc-950"
                    : "text-zinc-200 hover:bg-zinc-800"
                }`}
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-700 text-sm font-bold">
                  {contact.username.slice(0, 1)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-medium">{contact.username}</p>
                    <span className="text-xs opacity-70">{contact.lastSeen}</span>
                  </div>
                  <p className="truncate text-sm opacity-70">{contact.title}</p>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="flex min-h-screen flex-col">
          <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-800">
                <UserRound size={21} />
              </div>
              <div>
                <h1 className="font-semibold">{selectedContact?.username ?? "Select a chat"}</h1>
                <p className="text-sm text-zinc-400">
                  {selectedContact ? "End-to-end encrypted" : "Choose a contact to begin"}
                </p>
              </div>
            </div>
            <div className="hidden items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200 sm:flex">
              <Lock size={15} />
              AES-GCM + RSA-OAEP
            </div>
          </header>

          <div className="flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top_left,_rgba(52,211,153,0.10),_transparent_28%),#09090b] px-4 py-6">
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              <div className="mx-auto max-w-xl rounded-lg border border-zinc-800 bg-zinc-900/90 p-4 text-center text-sm leading-6 text-zinc-300">
                <ShieldCheck className="mx-auto mb-2 text-emerald-300" size={22} />
                The UI shows plaintext only after browser-side decryption. The
                server payload is ciphertext, IV, and an encrypted AES key.
              </div>

              {!selectedContact ? (
                <div className="mx-auto max-w-xl rounded-lg border border-dashed border-zinc-700 bg-zinc-950/80 p-6 text-center">
                  <MessageCircle className="mx-auto text-emerald-300" size={28} />
                  <h2 className="mt-3 font-semibold">Start a conversation</h2>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">
                    Register another account in an incognito window or another
                    browser, then search that username from the sidebar.
                  </p>
                </div>
              ) : null}

              {selectedContact && activeMessages.length === 0 ? (
                <div className="mx-auto max-w-xl rounded-lg border border-dashed border-zinc-700 bg-zinc-950/80 p-6 text-center">
                  <Lock className="mx-auto text-emerald-300" size={28} />
                  <h2 className="mt-3 font-semibold">
                    No messages with {selectedContact.username} yet
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">
                    Send the first message. It will be encrypted before it is
                    posted to the backend.
                  </p>
                </div>
              ) : null}

              {activeMessages.map((message) => {
                const isMine = message.senderId === user.id;
                return (
                  <article
                    key={message.id}
                    className={`flex ${isMine ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[82%] rounded-xl px-4 py-3 shadow-lg ${
                        isMine
                          ? "bg-emerald-400 text-zinc-950"
                          : "border border-zinc-800 bg-zinc-900 text-zinc-100"
                      }`}
                    >
                      <p className="whitespace-pre-wrap text-sm leading-6">
                        {message.status === "failed"
                          ? "Could not decrypt this message on this device."
                          : message.plaintext}
                      </p>
                      <div className="mt-2 flex items-center justify-end gap-2 text-[11px] opacity-70">
                        <span>{formatTime(message.createdAt)}</span>
                        {isMine ? <CheckCheck size={14} /> : <Lock size={12} />}
                      </div>
                    </div>
                  </article>
                );
              })}

              <div ref={messageEndRef} />
            </div>
          </div>

          <div className="border-t border-zinc-800 bg-zinc-900 px-4 py-3">
            <form onSubmit={sendMessage} className="mx-auto flex max-w-3xl items-center gap-3">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={!selectedContact}
                className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm outline-none transition placeholder:text-zinc-500 focus:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
                placeholder={
                  selectedContact
                    ? `Encrypted message to ${selectedContact.username}`
                    : "Select a chat first"
                }
              />
              <button
                disabled={isSending || !selectedContact || !draft.trim()}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-emerald-400 text-zinc-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
                title="Send encrypted message"
              >
                <Send size={19} />
              </button>
            </form>
            <p className="mx-auto mt-2 max-w-3xl truncate text-xs text-zinc-500">{status}</p>
          </div>
        </section>
      </div>
    </main>
  );
}
