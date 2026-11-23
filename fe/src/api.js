import axios from 'axios'

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api/v1',
})

api.interceptors.request.use((config) => {
  const accessToken = localStorage.getItem('spa_access_token')
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`
  return config
})

let refreshing = null
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status
    const original = error.config
    if (status === 401 && !original._retry) {
      original._retry = true
      try {
        const refreshToken = localStorage.getItem('spa_refresh_token')
        refreshing ||= api.post('/auth/refresh', { refreshToken })
        const { data } = await refreshing
        refreshing = null
        localStorage.setItem('spa_access_token', data.data.accessToken)
        original.headers.Authorization = `Bearer ${data.data.accessToken}`
        return api(original)
      } catch {
        refreshing = null
        localStorage.removeItem('spa_access_token')
        localStorage.removeItem('spa_refresh_token')
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  },
)
