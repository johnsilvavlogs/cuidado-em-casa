import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { CareError } from "./care-domain";

const email = z.string().trim().max(254).email().transform((value) => value.toLowerCase());
const password = z.string().min(8).max(128);
const loginSchema = z.object({ email, password }).strict();
const registrationSchema = loginSchema.extend({ name: z.string().trim().min(1).max(100).refine((value) => !/[\x00-\x1f]/.test(value)) });
const SCRYPT_OPTIONS = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;
const DUMMY_SALT = "386eb759c3aa5240b79f6f8478112953";

export function parseRegistration(input: unknown): z.infer<typeof registrationSchema> {
  const result = registrationSchema.safeParse(input);
  if (!result.success) throw new CareError("Informe seu nome, um e-mail válido e uma senha de 8 a 128 caracteres.");
  return result.data;
}

export function parseLogin(input: unknown): z.infer<typeof loginSchema> {
  const result = loginSchema.safeParse(input);
  if (!result.success) throw new CareError("E-mail ou senha inválidos.", 401);
  return result.data;
}

function derivePassword(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<{ salt: string; hash: string }> {
  const salt = randomBytes(16).toString("hex");
  return { salt, hash: (await derivePassword(password, salt)).toString("hex") };
}

export async function verifyPassword(password: string, salt?: string, expectedHash?: string): Promise<boolean> {
  // Missing accounts still perform the same password work.
  const actual = await derivePassword(password, salt ?? DUMMY_SALT);
  const expected = expectedHash ? Buffer.from(expectedHash, "hex") : Buffer.alloc(KEY_LENGTH);
  return actual.length === expected.length && timingSafeEqual(actual, expected) && expectedHash !== undefined;
}
