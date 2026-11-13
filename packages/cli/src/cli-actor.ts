import os from 'node:os';
import type { AuditActor } from '@openldr/bootstrap';
import { servedHandoff } from './served';

let override: string | undefined;

/** Set by the program's preAction hook from --actor. */
export function setActorOverride(name: string | undefined): void {
  override = name && name.trim() ? name.trim() : undefined;
}

/** In served mode, the signed-in account, with the detail that it came through the CLI and, for a
 *  key, the key's name. Null otherwise. */
function servedActor(): AuditActor | null {
  const handoff = servedHandoff();
  if (!handoff) return null;
  const { id, username, keyName } = handoff.caller;
  return { actorType: 'user', actorId: id, actorName: username, origin: keyName ? { via: 'cli', keyName } : { via: 'cli' } };
}

/** The audit actor for a CLI invocation. In served mode, the signed-in account, and --actor has no
 *  effect. Otherwise actor_type 'cli', name = --actor override or the OS user. */
export function cliActor(): AuditActor {
  const served = servedActor();
  if (served) return served;
  let name = override;
  if (!name) {
    try {
      name = os.userInfo().username;
    } catch {
      name = undefined;
    }
  }
  return { actorType: 'cli', actorId: null, actorName: name || 'cli' };
}

/** The name to record as the person who did something (createdBy, approvedBy, updatedBy and the
 *  like): the signed-in account's username in served mode, 'cli' otherwise. */
export function callerName(): string {
  return servedHandoff()?.caller.username ?? 'cli';
}

/** The signed-in account as `{ id, name }`, for the plugin, marketplace and sync code that takes
 *  an actor of that shape, as the Studio routes pass it. Null outside served mode, so each caller
 *  keeps what it passed before. */
export function servedCaller(): { id: string; name: string } | null {
  const handoff = servedHandoff();
  return handoff ? { id: handoff.caller.id, name: handoff.caller.username } : null;
}

/** The audit actor for the places that record the fixed name 'cli' rather than the OS user. In
 *  served mode, the signed-in account, as cliActor() gives. */
export function cliNamedActor(): AuditActor {
  return servedActor() ?? { actorType: 'cli', actorId: null, actorName: 'cli' };
}
