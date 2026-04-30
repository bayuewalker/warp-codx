export type Session = {
  id: string;
  label: string;
  created_at: string;
  updated_at: string;
};

export type MessageRole = "user" | "assistant" | "system";

export type Message = {
  id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  created_at: string;
};
