import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Archive,
  ArrowLeft,
  CheckCheck,
  Folder,
  Lock,
  LogOut,
  Menu,
  MessageCircle,
  Mic,
  MoreVertical,
  PanelRight,
  Paperclip,
  Phone,
  Search,
  Send,
  Smile,
  Star,
  X,
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
  const [activeFolder, setActiveFolder] = useState<"general" | "unread" | "groups">(
    "general"
  );
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Private key is kept in this browser session.");
  const [isStarting, setIsStarting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const selectedContact = contacts.find((contact) => contact.id === selectedContactId);

  const latestMessageByContact = useMemo(() => {
    const latest = new Map<string, ChatMessage>();

    messages.forEach((message) => {
      const current = latest.get(message.contactId);
      if (
        !current ||
        new Date(message.createdAt).getTime() > new Date(current.createdAt).getTime()
      ) {
        latest.set(message.contactId, message);
      }
    });

    return latest;
  }, [messages]);

  const unreadContactIds = useMemo(() => {
    if (!user) {
      return new Set<string>();
    }

    return new Set(
      Array.from(latestMessageByContact.values())
        .filter((message) => message.senderId !== user.id)
        .map((message) => message.contactId)
    );
  }, [latestMessageByContact, user]);

  const visibleContacts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const folderContacts =
      activeFolder === "groups"
        ? []
        : activeFolder === "unread"
          ? contacts.filter((contact) => unreadContactIds.has(contact.id))
          : contacts;

    if (!query) {
      return folderContacts;
    }

    return folderContacts.filter((contact) =>
      `${contact.username} ${contact.title}`.toLowerCase().includes(query)
    );
  }, [activeFolder, contacts, search, unreadContactIds]);

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
    if (!composerRef.current) {
      return;
    }

    composerRef.current.style.height = "44px";
    composerRef.current.style.height = `${Math.min(
      composerRef.current.scrollHeight,
      128
    )}px`;
  }, [draft]);

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

        return Array.from(existing.values());
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
      <main className="min-h-screen overflow-x-hidden bg-[#212121] px-5 py-8 text-white sm:py-12">
        <div className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-[540px] flex-col items-center justify-center">
          <div className="mb-10 flex h-40 w-40 items-center justify-center rounded-full bg-[#8774e1] sm:h-48 sm:w-48">
            <Star size={86} className="fill-[#212121] text-[#212121] sm:h-28 sm:w-28" />
          </div>

          <div className="mb-9 text-center">
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Sign in to Sollygram
            </h1>
            <p className="mx-auto mt-6 max-w-[360px] text-xl leading-8 text-[#b8b8b8] sm:text-2xl">
              Enter your username and password to unlock your encrypted chats.
            </p>
          </div>

          <form
            onSubmit={startSession}
            className="w-full"
          >
            <label className="relative block rounded-xl border border-[#3a3a3a] px-5 pb-3 pt-2 focus-within:border-[#8774e1]">
              <span className="text-sm font-medium text-[#8774e1]">Username</span>
              <input
                value={usernameInput}
                onChange={(event) => setUsernameInput(event.target.value)}
                className="mt-1 w-full bg-transparent text-xl text-white outline-none placeholder:text-[#8f8f8f]"
                placeholder="e.g. solly"
              />
            </label>

            <label className="relative mt-5 block rounded-xl border border-[#3a3a3a] px-5 pb-3 pt-2 focus-within:border-[#8774e1]">
              <span className="text-sm font-medium text-[#8774e1]">Password</span>
              <input
                value={passwordInput}
                onChange={(event) => setPasswordInput(event.target.value)}
                className="mt-1 w-full bg-transparent text-xl text-white outline-none placeholder:text-[#8f8f8f]"
                placeholder="minimum 8 characters"
                type="password"
              />
            </label>

            <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl bg-[#181818] p-1">
              <button
                type="button"
                onClick={() => setAuthMode("register")}
                className={`rounded-lg px-3 py-3 text-sm font-semibold ${
                  authMode === "register"
                    ? "bg-[#8774e1] text-white"
                    : "text-[#9b9b9b]"
                }`}
              >
                Register
              </button>
              <button
                type="button"
                onClick={() => setAuthMode("login")}
                className={`rounded-lg px-3 py-3 text-sm font-semibold ${
                  authMode === "login"
                    ? "bg-[#8774e1] text-white"
                    : "text-[#9b9b9b]"
                }`}
              >
                Login
              </button>
            </div>

            <button
              disabled={isStarting}
              className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-[#8774e1] px-4 py-5 text-lg font-semibold text-white transition hover:bg-[#9787e8] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Lock size={18} />
              {isStarting
                ? "Working..."
                : authMode === "register"
                  ? "Create encrypted account"
                  : "Login and unlock key"}
            </button>

            <p className="mt-5 rounded-xl border border-[#333] bg-[#181818] p-4 text-sm leading-6 text-[#b8b8b8]">
              {status}
            </p>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="h-screen overflow-hidden bg-[#0e1621] text-[#f4f7fb]">
      <div className="hidden h-0 items-center justify-end gap-6 bg-[#243241] px-5 text-[#6f8191]">
        <span className="h-0.5 w-4 bg-[#6f8191]" />
        <span className="h-3.5 w-3.5 rounded-sm border-2 border-[#6f8191]" />
        <X size={18} />
      </div>

      <div className="grid h-[100dvh] min-h-0 grid-cols-1 overflow-hidden md:grid-cols-[76px_320px_minmax(0,1fr)] lg:grid-cols-[86px_420px_minmax(0,1fr)] xl:grid-cols-[86px_520px_minmax(0,1fr)]">
        <nav className="hidden flex-col bg-[#111b26] text-[#8aa6c1] md:flex">
          <div className="flex-1">
            <button className="flex h-14 w-full items-center justify-center text-[#8aa6c1]">
              <Menu size={27} />
            </button>

            {[
              {
                id: "general",
                label: "General",
                icon: MessageCircle,
                count: contacts.length || undefined,
              },
              {
                id: "unread",
                label: "Unread",
                icon: MessageCircle,
                count: unreadContactIds.size || undefined,
              },
              { id: "groups", label: "Groups", icon: Folder, count: "3" },
            ].map((item) => {
              const Icon = item.icon;
              const isActive = activeFolder === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() =>
                    setActiveFolder(item.id as "general" | "unread" | "groups")
                  }
                  className={`relative flex h-[78px] w-full flex-col items-center justify-center gap-1 text-[14px] ${
                    isActive ? "bg-[#213247] text-[#54b8ff]" : "hover:bg-[#172536]"
                  }`}
                >
                  <div className="relative">
                    <Icon
                      size={29}
                      className={isActive ? "fill-[#54b8ff]" : "fill-[#8aa6c1]"}
                    />
                    {item.count ? (
                      <span className="absolute -right-4 -top-2 rounded-full bg-[#55bdf6] px-1.5 py-0.5 text-[13px] font-medium leading-none text-white">
                        {item.count}
                      </span>
                    ) : null}
                  </div>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          <button
            onClick={logout}
            className="mb-4 flex h-[72px] w-full flex-col items-center justify-center gap-1 text-[13px] hover:bg-[#172536]"
            title="Log out"
          >
            <LogOut size={26} />
            <span>Logout</span>
          </button>
        </nav>

        <aside
          className={`${
            selectedContact ? "hidden md:block" : "block"
          } min-h-0 border-r border-[#101820] bg-[#17212b] md:col-start-2`}
        >
          <div className="flex h-[68px] items-center gap-3 px-4">
            <div className="flex min-w-0 flex-1 items-center gap-3 rounded-full bg-[#242f3d] px-6 py-3">
              <Search size={20} className="text-[#7e91a3]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="w-full bg-transparent text-[17px] text-[#d7e4ef] outline-none placeholder:text-[#7e91a3]"
                placeholder="Search"
              />
            </div>
            <div className="flex -space-x-3">
              {[user.username, "E2", "VO"].map((name, index) => (
                <div
                  key={`${name}-${index}`}
                  className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-[#17212b] bg-[#44a8d8] text-[10px] font-bold"
                >
                  {name.slice(0, 2).toUpperCase()}
                </div>
              ))}
            </div>
          </div>

          <div className="h-[calc(100%-68px)] overflow-y-auto">
            <button className="grid w-full grid-cols-[70px_1fr] items-center px-4 py-2 text-left hover:bg-[#202d3a]">
              <div className="flex h-[54px] w-[54px] items-center justify-center rounded-full bg-[#607a92]">
                <Archive size={25} className="fill-white text-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center justify-between">
                  <p className="text-[17px] font-semibold text-white">Archived chats</p>
                  <span className="rounded-full bg-[#40617d] px-2 py-0.5 text-[12px] font-semibold">
                    33
                  </span>
                </div>
                <p className="truncate text-[15px] font-semibold text-white">
                  Encrypted conversations
                </p>
              </div>
            </button>

            {contacts.length === 0 && activeFolder !== "groups" ? (
              <div className="mx-4 my-5 rounded-xl border border-[#2d3d4c] bg-[#111b26] p-5 text-[16px] leading-7 text-[#91a8bd]">
                <p className="font-semibold text-white">No chats yet</p>
                <p>Search for another registered username to start a conversation.</p>
              </div>
            ) : null}

            {contacts.length > 0 && visibleContacts.length === 0 && activeFolder !== "groups" ? (
              <div className="mx-4 my-5 rounded-xl border border-[#2d3d4c] bg-[#111b26] p-5 text-[16px] leading-7 text-[#91a8bd]">
                {activeFolder === "unread"
                  ? "No unread chats."
                  : "No matching chats. Keep typing to search registered users."}
              </div>
            ) : null}

            {visibleContacts.map((contact, index) => (
              <button
                key={contact.id}
                onClick={() => {
                  setSelectedContactId(contact.id);
                  if (contact.isRemote) {
                    void loadRemoteMessages(contact);
                  }
                }}
                className={`grid h-[78px] w-full grid-cols-[70px_1fr] items-center px-4 text-left transition ${
                  selectedContactId === contact.id
                    ? "bg-[#38658d]"
                    : "hover:bg-[#202d3a]"
                }`}
              >
                <div
                  className={`flex h-[54px] w-[54px] items-center justify-center rounded-full text-[22px] font-medium text-white ${
                    index % 4 === 0
                      ? "bg-[#45aed6]"
                      : index % 4 === 1
                        ? "bg-[#8c6be8]"
                        : index % 4 === 2
                          ? "bg-[#ef6290]"
                          : "bg-[#f0a63a]"
                  }`}
                >
                  {contact.username.slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-4">
                    <p className="truncate text-[17px] font-semibold text-white">
                      {contact.username}
                    </p>
                    <span className="shrink-0 text-[14px] text-[#9bb4cb]">
                      {contact.lastSeen}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-4">
                    <p className="truncate text-[15px] text-[#9bb4cb]">
                      {latestMessageByContact.get(contact.id)?.plaintext ?? contact.title}
                    </p>
                    {unreadContactIds.has(contact.id) ? (
                      <span className="rounded-full bg-[#5eb6f1] px-2 py-0.5 text-[12px] font-semibold text-white">
                        1
                      </span>
                    ) : null}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section
          className={`${
            selectedContact ? "flex" : "hidden md:flex"
          } min-h-0 flex-col bg-[#0e1621] md:col-start-3`}
        >
          <header className="flex h-[68px] shrink-0 items-center justify-between bg-[#17212b] px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-3">
              {selectedContact ? (
                <button
                  onClick={() => setSelectedContactId(null)}
                  className="rounded-full p-1 text-[#8aa6c1] hover:bg-[#243241] md:hidden"
                  title="Back to chats"
                >
                  <ArrowLeft size={22} />
                </button>
              ) : null}
              <div className="min-w-0">
                <h1 className="truncate text-[18px] font-semibold leading-6 text-white">
                  {selectedContact?.username ?? "Select a chat"}
                </h1>
                <p className="truncate text-[14px] leading-5 text-[#8fa8bf]">
                  {selectedContact ? "last seen recently" : "search users from the sidebar"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 text-[#7d8c9b] lg:gap-6">
              <Search size={24} />
              <Phone size={24} />
              <PanelRight size={24} />
              <MoreVertical size={24} />
            </div>
          </header>

          <div className="flex min-h-[58px] shrink-0 items-center justify-between bg-[#1c2b3a] px-4 sm:px-7">
            <div className="border-l-4 border-[#56aee9] pl-3">
              <p className="text-[16px] text-[#56b7ff]">Pinned message</p>
              <p className="text-[15px] text-white">
                E2EE active: AES-GCM messages, RSA-OAEP message keys.
              </p>
            </div>
            <X size={24} className="text-[#7d8c9b]" />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-[#0e1621] px-3 py-4 sm:px-6 sm:py-6">
            <div className="flex min-h-full flex-col gap-2">
              {!selectedContact ? (
                <div className="mx-auto mt-24 max-w-md rounded-2xl bg-[#17212b] p-6 text-center text-[#9db2c6]">
                  <MessageCircle className="mx-auto mb-3 text-[#56b7ff]" size={34} />
                  <p className="text-[20px] font-semibold text-white">Start a conversation</p>
                  <p className="mt-2 text-[16px] leading-7">
                    Register another account in incognito, then search that username
                    from the left sidebar.
                  </p>
                </div>
              ) : null}

              {selectedContact && activeMessages.length === 0 ? (
                <div className="mx-auto mt-24 max-w-md rounded-2xl bg-[#17212b] p-6 text-center text-[#9db2c6]">
                  <Lock className="mx-auto mb-3 text-[#56b7ff]" size={34} />
                  <p className="text-[20px] font-semibold text-white">
                    No messages with {selectedContact.username} yet
                  </p>
                  <p className="mt-2 text-[16px] leading-7">
                    Send the first encrypted message.
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
                      className={`relative max-w-[86%] rounded-2xl px-4 py-2 text-[16px] leading-6 shadow sm:max-w-[72%] xl:max-w-[58%] ${
                        isMine
                          ? "rounded-br-md bg-[#38658d] text-white"
                          : "rounded-bl-md bg-[#182533] text-white"
                      }`}
                    >
                      <p className="whitespace-pre-wrap pr-20">
                        {message.status === "failed"
                          ? "Could not decrypt this message on this device."
                          : message.plaintext}
                      </p>
                      <div className="absolute bottom-2 right-4 flex items-center gap-2 text-[14px] text-[#94b4cf]">
                        <span>{formatTime(message.createdAt)}</span>
                        {isMine ? <CheckCheck size={17} className="text-[#6bc8ff]" /> : null}
                      </div>
                    </div>
                  </article>
                );
              })}

              <div ref={messageEndRef} />
            </div>
          </div>

          <footer className="min-h-[66px] shrink-0 border-t border-[#1d2a36] bg-[#17212b] px-3 py-2 sm:px-6">
            <form onSubmit={sendMessage} className="flex min-h-[48px] items-end gap-4">
              <Paperclip size={28} className="shrink-0 text-[#7d8c9b]" />
              <textarea
                ref={composerRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                disabled={!selectedContact}
                rows={1}
                className="max-h-32 min-h-11 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-2 text-[17px] leading-6 text-white outline-none placeholder:text-[#6f8191] disabled:cursor-not-allowed disabled:opacity-60"
                placeholder={
                  selectedContact
                    ? "Write a message..."
                    : "Select a chat first"
                }
              />
              <button
                type="button"
                className="shrink-0 pb-2 text-[#7d8c9b]"
                title="Emoji"
              >
                <Smile size={28} />
              </button>
              <button
                type="submit"
                disabled={isSending || !selectedContact || !draft.trim()}
                className="shrink-0 pb-2 text-[#7d8c9b] transition hover:text-[#5eb6f1] disabled:cursor-not-allowed disabled:opacity-40"
                title="Send encrypted message"
              >
                {draft.trim() ? <Send size={27} /> : <Mic size={29} />}
              </button>
            </form>
          </footer>
        </section>
      </div>
    </main>
  );
}
