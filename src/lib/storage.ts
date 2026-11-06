import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from './config.js'
import { badRequest } from './errors.js'

/** Where uploaded files live. Swap the implementation for S3-compatible storage later without touching callers. */
export interface Storage {
  put(folder: string, data: Buffer, ext: string): Promise<string>
  get(key: string): Promise<Buffer | null>
  delete(key: string): Promise<void>
}

export class LocalStorage implements Storage {
  constructor(private root: string) {}

  private resolve(key: string) {
    const full = path.resolve(this.root, key)
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw badRequest('Bad file path')
    return full
  }
  async put(folder: string, data: Buffer, ext: string) {
    const safeFolder = folder.replace(/[^a-z0-9_-]/gi, '')
    const key = `${safeFolder}/${crypto.randomUUID()}.${ext.replace(/[^a-z0-9]/gi, '')}`
    const full = this.resolve(key)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, data, { mode: 0o600 })
    return key
  }
  async get(key: string) {
    try {
      return await fs.readFile(this.resolve(key))
    } catch {
      return null
    }
  }
  async delete(key: string) {
    await fs.rm(this.resolve(key), { force: true })
  }
}

const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

/** S3-compatible object storage. Keys have the same shape as LocalStorage, so a deployment can switch without migrating rows. */
export class S3Storage implements Storage {
  constructor(private client: S3Client, private bucket: string) {}

  private check(key: string) {
    if (!/^[a-z0-9_-]+\/[a-f0-9-]{36}\.[a-z0-9]+$/i.test(key)) throw badRequest('Bad file path')
    return key
  }
  async put(folder: string, data: Buffer, ext: string) {
    const safeExt = ext.replace(/[^a-z0-9]/gi, '')
    const key = `${folder.replace(/[^a-z0-9_-]/gi, '')}/${crypto.randomUUID()}.${safeExt}`
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: MIME[safeExt.toLowerCase()] ?? 'application/octet-stream' }))
    return key
  }
  async get(key: string) {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.check(key) }))
      return res.Body ? Buffer.from(await res.Body.transformToByteArray()) : null
    } catch (e) {
      const name = (e as { name?: string }).name
      if (name === 'NoSuchKey' || name === 'NotFound') return null
      throw e
    }
  }
  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.check(key) }))
  }
}

export function createStorage(c: Pick<typeof config, 'STORAGE_DIR' | 'S3_BUCKET' | 'S3_ENDPOINT' | 'S3_REGION' | 'S3_ACCESS_KEY_ID' | 'S3_SECRET_ACCESS_KEY' | 'S3_FORCE_PATH_STYLE'>): Storage {
  if (!c.S3_BUCKET) return new LocalStorage(c.STORAGE_DIR)
  const client = new S3Client({
    region: c.S3_REGION,
    ...(c.S3_ENDPOINT ? { endpoint: c.S3_ENDPOINT } : {}),
    forcePathStyle: c.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: c.S3_ACCESS_KEY_ID, secretAccessKey: c.S3_SECRET_ACCESS_KEY },
  })
  return new S3Storage(client, c.S3_BUCKET)
}

export const storage: Storage = createStorage(config)

export type ImageType = { ext: 'jpg' | 'png' | 'webp'; mime: string }

/** Decide the type from the first bytes, ignoring whatever the client claimed. */
export function sniffImage(buf: Buffer): ImageType | null {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg' }
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: 'png', mime: 'image/png' }
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return { ext: 'webp', mime: 'image/webp' }
  return null
}

export function requireImage(buf: Buffer): ImageType {
  const t = sniffImage(buf)
  if (!t) throw badRequest('Only JPEG, PNG or WebP images are accepted')
  return t
}
