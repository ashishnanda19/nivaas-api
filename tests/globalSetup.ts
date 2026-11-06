import { execSync } from 'node:child_process'

export default function setup() {
  const url = process.env.DATABASE_URL_TEST ?? 'postgresql://nivaas@localhost:5433/nivaas_test'
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' })
}
