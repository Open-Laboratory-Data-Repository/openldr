// The lock: this PC shows OpenLDR and nothing else until someone types the PIN. Only a salted
// hash of the PIN is kept. This stops a casual user. It does not stop someone who can edit the
// settings file with the PC's account, and clearing `lock` there is how a forgotten PIN is recovered.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const MIN_PIN_LENGTH = 4;
export const WRONG_PIN_WAIT_MS = 2_000;

const SALT_BYTES = 16;
const HASH_BYTES = 32;
const HEX = /^[0-9a-f]+$/;

/** scrypt, 32 bytes, a fresh 16 byte salt. Both as lower case hex. */
export function makeLock(pin: string): { salt: string; hash: string } {
  const salt = randomBytes(SALT_BYTES);
  return { salt: salt.toString('hex'), hash: scryptSync(pin, salt, HASH_BYTES).toString('hex') };
}

/** Compares with timingSafeEqual. False for a malformed lock. */
export function checkPin(lock: { salt: string; hash: string }, pin: string): boolean {
  if (lock.salt.length !== SALT_BYTES * 2 || lock.hash.length !== HASH_BYTES * 2) return false;
  if (!HEX.test(lock.salt) || !HEX.test(lock.hash)) return false;
  const made = scryptSync(pin, Buffer.from(lock.salt, 'hex'), HASH_BYTES);
  return timingSafeEqual(made, Buffer.from(lock.hash, 'hex'));
}

/**
 * One PIN try at a time. A wrong PIN waits WRONG_PIN_WAIT_MS before it answers. A try that
 * arrives during that wait gets 'busy' and is not checked.
 */
export function pinGate(
  lock: { salt: string; hash: string },
  sleep: (ms: number) => Promise<void>,
): { submit(pin: string): Promise<'ok' | 'wrong' | 'busy'> } {
  let waiting = false;
  return {
    async submit(pin) {
      if (waiting) return 'busy';
      if (checkPin(lock, pin)) return 'ok';
      waiting = true;
      try {
        await sleep(WRONG_PIN_WAIT_MS);
      } finally {
        waiting = false;
      }
      return 'wrong';
    },
  };
}
