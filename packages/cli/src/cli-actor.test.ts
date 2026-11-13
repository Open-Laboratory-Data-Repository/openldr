import { afterEach, describe, expect, it } from 'vitest';
import { callerName, cliActor, cliNamedActor, setActorOverride } from './cli-actor';
import { setServedHandoff, type ServedHandoff } from './served';

afterEach(() => setActorOverride(undefined));

describe('cliActor', () => {
  it('is actor_type cli with the OS user by default', () => {
    const a = cliActor();
    expect(a.actorType).toBe('cli');
    expect(a.actorId).toBeNull();
    expect(typeof a.actorName).toBe('string');
    expect(a.actorName.length).toBeGreaterThan(0);
  });
  it('uses the --actor override when set', () => {
    setActorOverride('release-bot');
    expect(cliActor().actorName).toBe('release-bot');
  });
  it('ignores a blank override', () => {
    setActorOverride('   ');
    expect(cliActor().actorName).not.toBe('');
  });
});

describe('cliActor in served mode', () => {
  const handoff = (keyName: string | null): ServedHandoff => ({
    path: 'roles list', argv: ['roles', 'list'], runDir: '/srv/run1', keptDirs: [],
    caller: { id: 'u-1', username: 'alice', displayName: 'Alice', keyName },
  });
  afterEach(() => setServedHandoff(null));

  it('records the account as the audit actor in served mode, and cli otherwise', () => {
    expect(cliActor().actorType).toBe('cli');
    expect(callerName()).toBe('cli');
    expect(cliNamedActor()).toEqual({ actorType: 'cli', actorId: null, actorName: 'cli' });

    setServedHandoff(handoff('ci'));
    const served = { actorType: 'user', actorId: 'u-1', actorName: 'alice', origin: { via: 'cli', keyName: 'ci' } };
    expect(cliActor()).toEqual(served);
    expect(cliNamedActor()).toEqual(served);
    expect(callerName()).toBe('alice');
  });

  it('leaves the key name out for a session, and ignores --actor', () => {
    setServedHandoff(handoff(null));
    setActorOverride('release-bot');
    expect(cliActor()).toEqual({ actorType: 'user', actorId: 'u-1', actorName: 'alice', origin: { via: 'cli' } });
    expect(Object.keys(cliActor().origin!)).toEqual(['via']);
  });
});
