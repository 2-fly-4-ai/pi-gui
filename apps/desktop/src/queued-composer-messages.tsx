import type { ComposerAttachment, QueuedComposerMessage } from "./desktop-state";
import { FileIcon } from "./icons";
import { attachmentSourceLabel, attachmentStatusLabel, attachmentTypeLabel, formatAttachmentSize, safeAttachmentName } from "./attachment-presentation";

interface QueuedComposerMessagesProps {
  readonly messages: readonly QueuedComposerMessage[];
  readonly editingQueuedMessageId?: string;
  readonly onEditMessage: (messageId: string) => void;
  readonly onRemoveMessage: (messageId: string) => void;
  readonly onSteerMessage: (messageId: string) => void;
  readonly onQueueMessage: (messageId: string) => void;
  readonly onMoveMessage: (messageId: string, direction: "up" | "down") => void;
  readonly onSendNextMessage: (messageId: string) => void;
  readonly onCancelEdit: () => void;
}

export function QueuedComposerMessages({
  messages,
  editingQueuedMessageId,
  onEditMessage,
  onRemoveMessage,
  onSteerMessage,
  onQueueMessage,
  onMoveMessage,
  onSendNextMessage,
  onCancelEdit,
}: QueuedComposerMessagesProps) {
  if (messages.length === 0 && !editingQueuedMessageId) {
    return null;
  }

  return (
    <div className="queued-composer-messages" data-testid="queued-composer-messages">
      {editingQueuedMessageId ? (
        <div className="queued-composer-messages__editing" data-testid="queued-composer-editing">
          <span>Editing queued message</span>
          <button type="button" onClick={onCancelEdit}>
            Cancel
          </button>
        </div>
      ) : null}
      {messages.map((message, index) => (
        <div
          className={`queued-composer-message ${message.id === editingQueuedMessageId ? "queued-composer-message--editing" : ""} ${message.recoveryState ? `queued-composer-message--${message.recoveryState}` : ""}`}
          data-testid="queued-composer-message"
          key={message.id}
        >
          <div className="queued-composer-message__header">
            <div className="queued-composer-message__summary">
              <div className="queued-composer-message__meta">
                <span>{message.mode === "steer" ? "Steer" : `Queued ${index + 1}`}</span>
                {hasContextManifest(message.metadata) ? <span>Context attached</span> : null}
                {message.recoveryState ? <span>{message.recoveryState === "invalid" ? "Needs edit" : "Recovered"}</span> : null}
              </div>
              {message.text ? <div className="queued-composer-message__text">{message.text}</div> : null}
              {message.recoveryReason ? <div className="queued-composer-message__recovery">{message.recoveryReason}</div> : null}
            </div>
            <div className="queued-composer-message__actions">
              <button
                aria-label={`Move queued message up ${message.text || message.id}`}
                disabled={index === 0}
                type="button"
                onClick={() => onMoveMessage(message.id, "up")}
              >
                ↑
              </button>
              <button
                aria-label={`Move queued message down ${message.text || message.id}`}
                disabled={index === messages.length - 1}
                type="button"
                onClick={() => onMoveMessage(message.id, "down")}
              >
                ↓
              </button>
              <button type="button" onClick={() => onSendNextMessage(message.id)}>
                Send next
              </button>
              {message.mode !== "steer" ? (
                <button type="button" onClick={() => onSteerMessage(message.id)}>
                  Steer
                </button>
              ) : (
                <button type="button" onClick={() => onQueueMessage(message.id)}>
                  Queue
                </button>
              )}
              <button type="button" onClick={() => onEditMessage(message.id)}>
                Edit
              </button>
              <button aria-label={`Delete queued message ${message.text || message.id}`} type="button" onClick={() => onRemoveMessage(message.id)}>
                Cancel
              </button>
            </div>
          </div>
          {message.attachments.length > 0 ? (
            <div className="queued-composer-message__attachments">
              {message.attachments.map((attachment, index) => (
                <QueuedAttachmentPreview attachment={attachment} key={`${message.id}:${attachment.name}:${index}`} />
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function hasContextManifest(metadata: unknown): boolean {
  return typeof metadata === "object"
    && metadata !== null
    && "contextManifestSnapshotId" in metadata
    && typeof (metadata as { contextManifestSnapshotId?: unknown }).contextManifestSnapshotId === "string";
}

function QueuedAttachmentPreview({ attachment }: { readonly attachment: ComposerAttachment }) {
  return (
    <div
      aria-label={`${safeAttachmentName(attachment)}, ${attachmentStatusLabel(attachment)}, ${attachmentSourceLabel(attachment)}`}
      className={`queued-composer-attachment queued-composer-attachment--${attachment.kind} queued-composer-attachment--${attachment.status ?? "ready"}`}
    >
      {attachment.kind === "image" ? (
        <img
          alt={safeAttachmentName(attachment)}
          className="queued-composer-attachment__preview"
          src={`data:${attachment.mimeType};base64,${attachment.data}`}
        />
      ) : (
        <span className="queued-composer-attachment__icon" aria-hidden="true">
          <FileIcon />
          <span>{attachmentTypeLabel(attachment)}</span>
        </span>
      )}
      <span className="queued-composer-attachment__content">
        <span className="queued-composer-attachment__name">{safeAttachmentName(attachment)}</span>
        <span className="queued-composer-attachment__meta">
          {attachmentStatusLabel(attachment)} · {attachmentSourceLabel(attachment)}
          {formatAttachmentSize(attachment) ? ` · ${formatAttachmentSize(attachment)}` : ""}
        </span>
      </span>
    </div>
  );
}
