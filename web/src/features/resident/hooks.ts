import { useSession } from '@/app/store'

export function useResident() {
  const user = useSession((s) => s.user)!
  return { user, flatId: user.flatId! }
}
