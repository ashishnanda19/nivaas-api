export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
  }
}
export const badRequest = (m: string, d?: unknown) => new AppError(400, 'BAD_REQUEST', m, d)
export const unauthorized = (m = 'Sign in required') => new AppError(401, 'UNAUTHORIZED', m)
export const forbidden = (m = 'You do not have access to this') => new AppError(403, 'FORBIDDEN', m)
export const notFound = (m = 'Not found') => new AppError(404, 'NOT_FOUND', m)
export const conflict = (m: string, d?: unknown) => new AppError(409, 'CONFLICT', m, d)
export const tooMany = (m = 'Too many attempts, try again later') => new AppError(429, 'RATE_LIMITED', m)
