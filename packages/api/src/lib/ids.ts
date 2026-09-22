import { randomBytes } from 'node:crypto';

// Unambiguous alphabet (no 0/O/1/I) for human-readable booking references.
const REFERENCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function bookingReference(): string {
  const bytes = randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i += 1) out += REFERENCE_ALPHABET[bytes[i] % REFERENCE_ALPHABET.length];
  return `BK-${out}`;
}

export function offerToken(): string {
  return randomBytes(24).toString('hex');
}
