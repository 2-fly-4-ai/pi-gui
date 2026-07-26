export interface StoredReviewQuestion {
  readonly id: string;
  readonly workspaceId: string;
  readonly snapshotId: string;
  readonly filePath: string;
  readonly anchorId: string;
  readonly rangeEndAnchorId?: string;
  readonly prompt: string;
  readonly createdAt: string;
  readonly answer?: {
    readonly messageId: string;
    readonly text: string;
    readonly attachedAt: string;
  };
}

export function readReviewQuestions(workspaceId: string): StoredReviewQuestion[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(workspaceId)) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStoredReviewQuestion);
  } catch {
    return [];
  }
}

export function saveReviewQuestion(question: StoredReviewQuestion): void {
  const current = readReviewQuestions(question.workspaceId);
  localStorage.setItem(storageKey(question.workspaceId), JSON.stringify([
    ...current.filter((candidate) => candidate.id !== question.id),
    question,
  ]));
}

export function attachLatestPendingReviewAnswer(
  workspaceId: string,
  message: { readonly id: string; readonly text: string },
): StoredReviewQuestion | undefined {
  const questions = readReviewQuestions(workspaceId);
  const pending = [...questions].reverse().find((question) => !question.answer);
  if (!pending) return undefined;
  const updated: StoredReviewQuestion = {
    ...pending,
    answer: {
      messageId: message.id,
      text: message.text,
      attachedAt: new Date().toISOString(),
    },
  };
  saveReviewQuestion(updated);
  return updated;
}

export function remapReviewQuestion(
  workspaceId: string,
  id: string,
  input: { readonly snapshotId: string; readonly anchorId: string; readonly rangeEndAnchorId?: string },
): void {
  const question = readReviewQuestions(workspaceId).find((candidate) => candidate.id === id);
  if (!question) return;
  saveReviewQuestion({ ...question, ...input });
}

function storageKey(workspaceId: string): string {
  return `pi-gui:review-questions:v1:${workspaceId}`;
}

function isStoredReviewQuestion(value: unknown): value is StoredReviewQuestion {
  return typeof value === "object"
    && value !== null
    && "id" in value
    && typeof value.id === "string"
    && "workspaceId" in value
    && typeof value.workspaceId === "string"
    && "snapshotId" in value
    && typeof value.snapshotId === "string"
    && "filePath" in value
    && typeof value.filePath === "string"
    && "anchorId" in value
    && typeof value.anchorId === "string"
    && "prompt" in value
    && typeof value.prompt === "string"
    && "createdAt" in value
    && typeof value.createdAt === "string";
}
