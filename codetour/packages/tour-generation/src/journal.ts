import { randomBytes } from "crypto";
import { promises as fs } from "fs";
import * as path from "path";
import { TourKind } from "./types";

// Creation journal: one record per created Tour, under
// `<workspace>/.tours/.log/creations/`. The hook surfaces of the agents read
// it to report the Tours a response actually created; the record therefore
// carries the creation time and whatever session identity the creating
// process could observe, and nothing else.
//
// It is observability only. A record is an independent file, written
// atomically after the Tour exists, so concurrent creations never contend for
// one document; a journal that cannot be written never fails the creation and
// is never reported as one.

/** Directory of the creation records, relative to the workspace root. */
export const CREATIONS_DIRECTORY = path.join(".tours", ".log", "creations");

export const CREATION_RECORD_VERSION = 1;

export interface CreationRecord {
  version: number;
  /** Canonical workspace root the creation was requested for. */
  workspace: string;
  /** Absolute path of the written Tour file. */
  tourPath: string;
  tourTitle: string;
  kind: TourKind;
  /** ISO timestamp of the successful write. */
  at: string;
  sessionId: string | null;
  responseId: string | null;
  host: string | null;
}

export interface CreationIdentity {
  sessionId: string | null;
  responseId: string | null;
  host: string | null;
}

function nonEmpty(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

// The identity is read from the environment of the creating process only: a
// value CodeTour cannot observe stays null instead of being guessed. The two
// explicit variables name the session, the response and the host; a host that
// exports its own session variable is only used when it identifies the host
// (Pi exports PI_SESSION_ID, whose presence also states the host). The Copilot
// CLI is absent here on purpose: it reports its session identity inside the
// hook payload, not in the environment of the process the agent spawns, so
// there is no verified variable to read.
export function creationIdentity(
  env: Record<string, string | undefined> = process.env
): CreationIdentity {
  const explicitSession = nonEmpty(env.CODETOUR_SESSION_ID);
  const piSession = nonEmpty(env.PI_SESSION_ID);
  return {
    sessionId: explicitSession ?? piSession,
    responseId: nonEmpty(env.CODETOUR_RESPONSE_ID),
    host: nonEmpty(env.CODETOUR_HOST) ?? (explicitSession === null && piSession !== null ? "pi" : null),
  };
}

export interface CreationRecordInput {
  workspaceRoot: string;
  tourPath: string;
  tourTitle: string;
  kind: TourKind;
}

// Write one creation record. Returns the written file, or undefined when the
// journal is unavailable; the caller treats that as a diagnostic, never as a
// failure of the creation itself.
export async function recordCreation(
  input: CreationRecordInput,
  identity: CreationIdentity = creationIdentity()
): Promise<string | undefined> {
  const createdAt = new Date();
  const record: CreationRecord = {
    version: CREATION_RECORD_VERSION,
    workspace: input.workspaceRoot,
    tourPath: input.tourPath,
    tourTitle: input.tourTitle,
    kind: input.kind,
    at: createdAt.toISOString(),
    sessionId: identity.sessionId,
    responseId: identity.responseId,
    host: identity.host,
  };
  const directory = path.join(input.workspaceRoot, CREATIONS_DIRECTORY);
  // `<createdAtMs>-<pid>-<random>`: sortable by time, unique under concurrent
  // creations from the same process.
  const fileName = `${createdAt.getTime()}-${process.pid}-${randomBytes(4).toString("hex")}.json`;
  const target = path.join(directory, fileName);
  const temporary = path.join(directory, `.${fileName}.tmp`);
  try {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    await fs.rename(temporary, target);
    return target;
  } catch {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    return undefined;
  }
}
