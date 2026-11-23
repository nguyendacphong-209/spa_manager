import jwt from 'jsonwebtoken'
import { User } from '../models/index.js'

export function signAccessToken(user) {
  return jwt.sign(
    { sub: String(user._id), role: user.role },
    process.env.JWT_ACCESS_SECRET || 'development-access-secret',
    { expiresIn: '15m' },
  )
}

export function signRefreshToken(user) {
  return jwt.sign(
    { sub: String(user._id), type: 'refresh' },
    process.env.JWT_REFRESH_SECRET || 'development-refresh-secret',
    { expiresIn: '7d' },
  )
}

export async function authenticate(request, response, next) {
  const token = request.headers.authorization?.replace(/^Bearer\s+/i, '')
  if (!token) {
    return response.status(401).json({ success: false, data: null, message: 'Vui lòng đăng nhập.', code: 'UNAUTHORIZED', meta: {} })
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET || 'development-access-secret')
    const user = await User.findById(payload.sub)
    if (!user || !user.isActive) throw new Error('inactive')
    request.user = user
    next()
  } catch {
    response.status(401).json({ success: false, data: null, message: 'Phiên đăng nhập không hợp lệ.', code: 'UNAUTHORIZED', meta: {} })
  }
}

export function requireOwner(request, response, next) {
  if (request.user?.role !== 'OWNER') {
    return response.status(403).json({ success: false, data: null, message: 'Chỉ chủ spa được thực hiện thao tác này.', code: 'FORBIDDEN', meta: {} })
  }
  next()
}
