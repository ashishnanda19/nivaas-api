import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/db.js'
import { createStorage, DbStorage, S3Storage } from '../src/lib/storage.js'
import { PNG } from './helpers.js'

// Runs against any S3-compatible server. Locally: docker run -p 9000:9000 minio/minio server /data
// then S3_TEST_ENDPOINT=http://localhost:9000 (default credentials minioadmin). Skipped when unset.
const endpoint = process.env.S3_TEST_ENDPOINT
const creds = { accessKeyId: process.env.S3_TEST_KEY ?? 'minioadmin', secretAccessKey: process.env.S3_TEST_SECRET ?? 'minioadmin' }

describe.skipIf(!endpoint)('S3Storage', () => {
  const bucket = `nivaas-test-${Date.now()}`
  const make = async () => {
    const client = new S3Client({ region: 'us-east-1', endpoint, forcePathStyle: true, credentials: creds })
    await client.send(new CreateBucketCommand({ Bucket: bucket })).catch(() => undefined)
    return new S3Storage(client, bucket)
  }

  it('stores, reads back and deletes a file', async () => {
    const s = await make()
    const key = await s.put('visitors', PNG, 'png')
    expect(key).toMatch(/^visitors\/[a-f0-9-]{36}\.png$/)
    expect((await s.get(key))!.equals(PNG)).toBe(true)
    await s.delete(key)
    expect(await s.get(key)).toBeNull()
  })

  it('returns null for a key that never existed', async () => {
    const s = await make()
    expect(await s.get('visitors/00000000-0000-0000-0000-000000000000.png')).toBeNull()
  })

  it('refuses keys that are not ones it issued', async () => {
    const s = await make()
    await expect(s.get('../etc/passwd')).rejects.toThrow()
    await expect(s.delete('visitors/../../x')).rejects.toThrow()
  })
})

describe('createStorage', () => {
  const base = { STORAGE_DRIVER: 'local' as const, STORAGE_DIR: './storage', S3_BUCKET: '', S3_ENDPOINT: '', S3_REGION: 'us-east-1', S3_ACCESS_KEY_ID: '', S3_SECRET_ACCESS_KEY: '', S3_FORCE_PATH_STYLE: false }
  it('uses local disk unless a bucket is configured', () => {
    expect(createStorage(base).constructor.name).toBe('LocalStorage')
    expect(createStorage({ ...base, STORAGE_DRIVER: 'db' }).constructor.name).toBe('DbStorage')
    expect(createStorage({ ...base, S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' }).constructor.name).toBe('S3Storage')
  })
})

describe('DbStorage', () => {
  it('stores, reads back and deletes a file in Postgres', async () => {
    const s = new DbStorage()
    const key = await s.put('complaints', PNG, 'png')
    expect(key).toMatch(/^complaints\/[a-f0-9-]{36}\.png$/)
    expect((await s.get(key))!.equals(PNG)).toBe(true)
    expect(await prisma.storedFile.count({ where: { key } })).toBe(1)
    await s.delete(key)
    expect(await s.get(key)).toBeNull()
  })
  it('returns null for a missing key, deletes quietly, and refuses keys it did not issue', async () => {
    const s = new DbStorage()
    expect(await s.get('visitors/00000000-0000-0000-0000-000000000000.png')).toBeNull()
    await s.delete('visitors/00000000-0000-0000-0000-000000000000.png')
    await expect(s.get('../etc/passwd')).rejects.toThrow()
  })
})
