export interface SessionTranscriptImageAttachment {
  readonly kind: "image";
  readonly mimeType: string;
  readonly data: string;
  readonly name?: string;
  /** The renderer may omit historical image bytes to stay within its memory budget. */
  readonly dataOmitted?: boolean;
  readonly sizeBytes?: number;
}

export interface SessionTranscriptFileAttachment {
  readonly kind: "file";
  readonly name: string;
  readonly mimeType: string;
  readonly fsPath: string;
  readonly sizeBytes?: number;
}

export type SessionTranscriptAttachment = SessionTranscriptImageAttachment | SessionTranscriptFileAttachment;

export type SessionTranscriptRole = "user" | "assistant" | "branchSummary" | "compactionSummary";

export interface SessionTranscriptMessage {
  readonly kind: "message";
  readonly role: SessionTranscriptRole;
  readonly text: string;
  readonly attachments?: readonly SessionTranscriptAttachment[];
  readonly metadata?: unknown;
  readonly createdAt: string;
  readonly id: string;
}

export interface SessionTranscriptThinking {
  readonly kind: "thinking";
  readonly id: string;
  readonly text: string;
  readonly createdAt: string;
  readonly status: "running" | "done";
}

export type SessionTranscriptEntry = SessionTranscriptMessage | SessionTranscriptThinking;
