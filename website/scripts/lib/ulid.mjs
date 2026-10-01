import { createHash } from 'node:crypto';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A ULID that is the same on every build: the time is the item's own date,
 * and the 80 bits after it come from hashing a key that names the item. Kite
 * keys the index and each feed entry's guid by it, so it must not change
 * between builds.
 */
export function stableULID(key, time = 0) {
  let value = BigInt(Math.max(0, Math.floor(time))) & ((1n << 48n) - 1n);
  const hash = createHash('sha256').update(key).digest();
  for (let i = 0; i < 10; i++) value = (value << 8n) | BigInt(hash[i]);
  let out = '';
  for (let i = 0; i < 26; i++) {
    out = CROCKFORD[Number(value & 31n)] + out;
    value >>= 5n;
  }
  return out;
}
