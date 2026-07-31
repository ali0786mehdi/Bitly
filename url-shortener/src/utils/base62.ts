import { customAlphabet } from 'nanoid';

// 62 characters: 0-9, a-z, A-Z. No ambiguous-looking separators, URL-safe
// by construction. At length 7, that's 62^7 ≈ 3.5 trillion possible codes —
// comfortably beyond "billions of links" before collision probability
// becomes a real concern (see README for the birthday-bound math).
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function generateShortCode(length: number): string {
  const nanoid = customAlphabet(ALPHABET, length);
  return nanoid();
}

export function isValidShortCode(code: string): boolean {
  return /^[0-9a-zA-Z]{1,16}$/.test(code);
}
