import { create } from 'zustand'

export const useAuthStore = create((set) => ({
  user: JSON.parse(localStorage.getItem('spa_user') || 'null'),
  setUser: (user) => {
    localStorage.setItem('spa_user', JSON.stringify(user))
    set({ user })
  },
  logout: () => {
    localStorage.removeItem('spa_access_token')
    localStorage.removeItem('spa_refresh_token')
    localStorage.removeItem('spa_user')
    set({ user: null })
  },
}))
