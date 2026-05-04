import { apiRequest } from "./client";
import type { EncryptedMessagePayload } from "../crypto/message";

export type SendMessagePayload = {
  to: string;
  payload: EncryptedMessagePayload;
};

export type EncryptedMessage = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  payload: EncryptedMessagePayload;
  created_at: string;
};

export type ConversationSummary = {
  user_id: string;
  display_name: string;
  username: string;
  last_message_at: string;
};

export function sendEncryptedMessage(
  token: string,
  recipientId: string,
  encrypted: EncryptedMessagePayload
) {
  return apiRequest<EncryptedMessage>("/messages", {
    method: "POST",
    token,
    body: {
      to: recipientId,
      payload: encrypted,
    } satisfies SendMessagePayload,
  });
}

export function listConversations(token: string) {
  return apiRequest<ConversationSummary[]>("/conversations", {
    token,
  });
}

export function getMessagesWithUser(token: string, userId: string, limit = 50) {
  return apiRequest<EncryptedMessage[]>(
    `/conversations/${userId}/messages?limit=${encodeURIComponent(limit)}`,
    {
      token,
    }
  );
}

export function getHealth() {
  return apiRequest<{ status: string; environment: string }>("/health");
}

export function sendEncryptedMessageToApi(
  token: string,
  recipientId: string,
  encrypted: EncryptedMessagePayload
) {
  return apiRequest<EncryptedMessage>("/messages", {
    method: "POST",
    token,
    body: {
      to: recipientId,
      payload: encrypted,
    } satisfies SendMessagePayload,
  });
}
