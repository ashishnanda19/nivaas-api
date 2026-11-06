import { mockApi } from './mock'
import type { Api } from './mock'
import { httpApi, setAuthLostHandler } from './http'

/**
 * The single entry point the UI talks to. The demo runs on the in-browser mock unless
 * VITE_USE_MOCK=false is set, in which case every call goes to the real API at VITE_API_URL.
 */
export const useMockApi = import.meta.env.VITE_USE_MOCK !== 'false'
export const api: Api = useMockApi ? mockApi : httpApi
export { setAuthLostHandler }
export { ApiError, resetDemoData } from './mock'
export type { Api }
export * from './types'
