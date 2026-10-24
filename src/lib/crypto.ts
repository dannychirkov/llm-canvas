import { webcrypto, randomBytes } from "node:crypto"

const subtle = webcrypto.subtle
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function getEncryptionSecret(): string {
  const secret = process.env.AUTH_SECRET;

  if (!secret) {
    // During build time, we allow missing AUTH_SECRET
    // It will be validated at runtime when actually needed
    if (process.env.NODE_ENV === 'production' && process.env.NEXT_PHASE !== 'phase-production-build') {
      throw new Error('FATAL: AUTH_SECRET is not set. Cannot derive encryption key in production!');
    }
    console.warn('⚠️  Using fallback secret for encryption in development/build mode');
    return 'fallback-secret-for-development';
  }

  return secret;
}

async function importKey(): Promise<CryptoKey> {
  const secret = getEncryptionSecret();
  const hash = await subtle.digest('SHA-256', encoder.encode(secret))
  return subtle.importKey(
    'raw',
    hash,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  )
}

export async function encryptString(plain: string): Promise<string> {
  const key = await importKey()
  const iv = Uint8Array.from(randomBytes(12))
  const ciphertext = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plain)
  )
  const payload = Buffer.concat([Buffer.from(iv), Buffer.from(new Uint8Array(ciphertext))])
  return payload.toString('base64')
}

export async function decryptString(encBase64: string): Promise<string> {
  const key = await importKey()
  const buf = Buffer.from(encBase64, 'base64')
  const iv = Uint8Array.from(buf.subarray(0, 12))
  const data = Uint8Array.from(buf.subarray(12))
  const plain = await subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  )
  return decoder.decode(plain)
}


