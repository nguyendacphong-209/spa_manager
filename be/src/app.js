import cors from 'cors'
import express from 'express'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import {
  Appointment,
  AppointmentHistory,
  Bed,
  BookingLock,
  CapacityOverride,
  Customer,
  Service,
  SpaSettings,
  StaffProfile,
  StaffSchedule,
  StaffTimeOff,
  User,
} from './models/index.js'
import { authenticate, requireOwner, signAccessToken, signRefreshToken } from './middleware/auth.js'
import { conflict, overlapFilter, success } from './utils.js'

const reservingStatuses = ['CONFIRMED', 'ARRIVED', 'IN_PROGRESS']

function validate(schema) {
  return (request, response, next) => {
    const result = schema.safeParse(request.body)
    if (!result.success) {
      return response.status(400).json({
        success: false,
        data: null,
        message: 'Dữ liệu không hợp lệ.',
        code: 'VALIDATION_ERROR',
        meta: { issues: result.error.issues },
      })
    }
    request.validatedBody = result.data
    next()
  }
}

async function ensureSettings() {
  let settings = await SpaSettings.findOne()
  if (!settings) settings = await SpaSettings.create({})
  return settings
}

async function getActiveCapacity(startAt, endAt) {
  await ensureSettings()
  const override = await CapacityOverride.findOne({
    startAt: { $lt: endAt },
    endAt: { $gt: startAt },
  }).sort({ createdAt: -1 })
  if (override) return override.maxConcurrentCustomers
  const settings = await SpaSettings.findOne()
  return settings?.defaultMaxConcurrentCustomers ?? 1
}

function safeInterval(startAt, durationMinutes, bufferMinutes = 0) {
  const start = new Date(startAt)
  const estimatedEndAt = new Date(start.getTime() + durationMinutes * 60_000)
  const occupiedEndAt = new Date(estimatedEndAt.getTime() + bufferMinutes * 60_000)
  return { startAt: start, estimatedEndAt, occupiedStartAt: start, occupiedEndAt }
}

async function checkAppointmentResources({ staffId, bedId, startAt, occupiedEndAt, excludeId }) {
  const staff = await StaffProfile.findOne({ _id: staffId, isActive: true, isServiceProvider: true })
  if (!staff) return 'Nhân viên phục vụ không hoạt động hoặc không được chỉ định.'

  const bed = await Bed.findOne({ _id: bedId, isActive: true })
  if (!bed) return 'Giường điều trị không hoạt động.'

  const overlap = overlapFilter(startAt, occupiedEndAt)
  if (excludeId) overlap._id = { $ne: excludeId }

  const staffConflict = await Appointment.exists({ ...overlap, staffId })
  if (staffConflict) return 'Nhân viên phục vụ đã có lịch trùng.'

  const bedConflict = await Appointment.exists({ ...overlap, bedId })
  if (bedConflict) return 'Giường điều trị đã được đặt.'

  const count = await Appointment.countDocuments({ ...overlap })
  const limit = await getActiveCapacity(startAt, occupiedEndAt)
  if (count >= limit) return 'Số khách đồng thời đã đạt giới hạn.'

  return null
}

export function createApp() {
  const app = express()
  app.set('trust proxy', 1)
  const allowedOrigins = (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  allowedOrigins.push('https://lemn-spa.vercel.app')
  app.use(cors({
    origin(origin, callback) {
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        /^https:\/\/lemn-spa(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(origin)
      ) {
        callback(null, true)
        return
      }
      callback(new Error('Origin không được phép'))
    },
  }))
  app.use(express.json())

  const api = express.Router()

  api.get('/health', (request, response) => {
    response.json(success({
      status: 'ok',
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    }))
  })
  app.get('/api/health', (request, response) => {
    response.json({
      status: 'ok',
      database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    })
  })
  app.get('/health', (request, response) => response.json({ success: true, data: { status: 'ok' } }))

  const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10 })
  api.post('/auth/login', loginLimiter, validate(z.object({
    email: z.string().email(),
    password: z.string().min(6),
  })), async (request, response, next) => {
    try {
      const user = await User.findOne({ email: request.validatedBody.email }).select('+passwordHash')
      if (!user || !user.isActive || !(await bcrypt.compare(request.validatedBody.password, user.passwordHash))) {
        return response.status(401).json({ success: false, data: null, message: 'Email hoặc mật khẩu không đúng.', code: 'INVALID_CREDENTIALS', meta: {} })
      }
      response.json(success({
        accessToken: signAccessToken(user),
        refreshToken: signRefreshToken(user),
        user: { id: user._id, email: user.email, fullName: user.fullName, role: user.role },
      }))
    } catch (error) { next(error) }
  })

  api.post('/auth/refresh', async (request, response) => {
    try {
      const payload = jwt.verify(request.body.refreshToken, process.env.JWT_REFRESH_SECRET || 'development-refresh-secret')
      const user = await User.findById(payload.sub)
      if (!user || !user.isActive) throw new Error('inactive')
      response.json(success({ accessToken: signAccessToken(user) }))
    } catch {
      response.status(401).json({ success: false, data: null, message: 'Phiên đăng nhập đã hết hạn.', code: 'UNAUTHORIZED', meta: {} })
    }
  })
  api.post('/auth/logout', (request, response) => response.json(success(null, 'Đã đăng xuất')))
  api.get('/auth/me', authenticate, (request, response) => response.json(success({
    id: request.user._id,
    email: request.user.email,
    fullName: request.user.fullName,
    role: request.user.role,
  })))

  api.use(authenticate)

  api.get('/users', requireOwner, async (request, response, next) => {
    try { response.json(success(await User.find().select('-passwordHash').sort({ createdAt: -1 }))) } catch (error) { next(error) }
  })
  api.post('/users', requireOwner, validate(z.object({
    email: z.string().email(), password: z.string().min(6), fullName: z.string().min(1), role: z.enum(['OWNER', 'STAFF']).default('STAFF'),
  })), async (request, response, next) => {
    try {
      const body = request.validatedBody
      const existing = await User.findOne({ email: body.email })
      if (existing) return response.status(409).json({ success: false, data: null, message: 'Email đã được sử dụng.', code: 'CONFLICT', meta: {} })
      const user = await User.create({ ...body, passwordHash: await bcrypt.hash(body.password, 12), isActive: true })
      response.status(201).json(success({ id: user._id, email: user.email, fullName: user.fullName, role: user.role }))
    } catch (error) { next(error) }
  })
  api.patch('/users/:id/status', requireOwner, validate(z.object({ isActive: z.boolean() })),
    async (request, response, next) => {
      try {
        const user = await User.findByIdAndUpdate(request.params.id, { isActive: request.validatedBody.isActive }, { new: true }).select('-passwordHash')
        if (!user) return response.status(404).json({ success: false, data: null, message: 'Không tìm thấy tài khoản.', code: 'NOT_FOUND', meta: {} })
        response.json(success(user))
      } catch (error) { next(error) }
    })

  api.route('/staff').get(async (request, response, next) => {
    try { response.json(success(await StaffProfile.find().populate('userId', 'fullName email role isActive').sort({ displayName: 1 }))) } catch (error) { next(error) }
  }).post(requireOwner, validate(z.object({
    fullName: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(6),
    phone: z.string().optional(),
  })), async (request, response, next) => {
    try {
      const body = request.validatedBody
      const existing = await User.findOne({ email: body.email })
      if (existing) {
        return response.status(409).json({ success: false, data: null, message: 'Email nhân viên đã được sử dụng.', code: 'CONFLICT', meta: {} })
      }
      const user = await User.create({
        email: body.email,
        passwordHash: await bcrypt.hash(body.password, 12),
        fullName: body.fullName,
        role: 'STAFF',
        isActive: true,
      })
      const staff = await StaffProfile.create({
        userId: user._id,
        displayName: body.fullName,
        phone: body.phone || '',
        isServiceProvider: true,
        isActive: true,
      })
      response.status(201).json(success(await StaffProfile.findById(staff._id).populate('userId', 'fullName email role isActive')))
    } catch (error) { next(error) }
  })

  api.route('/customers').get(async (request, response, next) => {
    try {
      const page = Math.max(1, Number(request.query.page) || 1)
      const limit = Math.min(100, Math.max(1, Number(request.query.limit) || 20))
      const keyword = String(request.query.keyword || '').trim()
      const filter = keyword ? { $or: [{ fullName: { $regex: keyword, $options: 'i' } }, { phone: { $regex: keyword, $options: 'i' } }] } : {}
      const [items, total] = await Promise.all([Customer.find(filter).sort({ fullName: 1 }).skip((page - 1) * limit).limit(limit), Customer.countDocuments(filter)])
      response.json(success(items, 'OK', { page, limit, total, pages: Math.ceil(total / limit) }))
    } catch (error) { next(error) }
  }).post(validate(z.object({ fullName: z.string().min(1), phone: z.string().min(1), email: z.string().email().optional().or(z.literal('')), notes: z.string().optional() })),
    async (request, response, next) => {
      try {
        const customer = await Customer.create(request.validatedBody)
        response.status(201).json(success(customer))
      } catch (error) { next(error) }
    })

  api.route('/customers/:id').get(async (request, response, next) => {
    try {
      const customer = await Customer.findById(request.params.id)
      if (!customer) return response.status(404).json({ success: false, data: null, message: 'Không tìm thấy khách hàng.', code: 'NOT_FOUND', meta: {} })
      const appointments = await Appointment.find({ customerId: customer._id }).sort({ startAt: -1 })
      response.json(success({ ...customer.toObject(), appointments }))
    } catch (error) { next(error) }
  }).patch(validate(z.object({ fullName: z.string().min(1).optional(), phone: z.string().min(1).optional(), email: z.string().email().optional().or(z.literal('')), notes: z.string().optional() })),
    async (request, response, next) => {
      try {
        const customer = await Customer.findByIdAndUpdate(request.params.id, request.validatedBody, { new: true, runValidators: true })
        if (!customer) return response.status(404).json({ success: false, data: null, message: 'Không tìm thấy khách hàng.', code: 'NOT_FOUND', meta: {} })
        response.json(success(customer))
      } catch (error) { next(error) }
    })

  api.route('/services').get(async (request, response, next) => {
    try { response.json(success(await Service.find().sort({ name: 1 }))) } catch (error) { next(error) }
  }).post(requireOwner, validate(z.object({ name: z.string().min(1), description: z.string().optional(), defaultPrice: z.number().min(0), defaultDurationMinutes: z.number().min(1), isActive: z.boolean().optional() })),
    async (request, response, next) => {
      try { response.status(201).json(success(await Service.create(request.validatedBody))) } catch (error) { next(error) }
    })
  api.patch('/services/:id', requireOwner, validate(z.object({ name: z.string().min(1).optional(), description: z.string().optional(), defaultPrice: z.number().min(0).optional(), defaultDurationMinutes: z.number().min(1).optional(), isActive: z.boolean().optional() })),
    async (request, response, next) => {
      try {
        const service = await Service.findByIdAndUpdate(request.params.id, request.validatedBody, { new: true, runValidators: true })
        if (!service) return response.status(404).json({ success: false, data: null, message: 'Không tìm thấy dịch vụ.', code: 'NOT_FOUND', meta: {} })
        response.json(success(service))
      } catch (error) { next(error) }
    })
  api.delete('/services/:id', requireOwner, async (request, response, next) => {
    try {
      const activeAppointments = await Appointment.exists({
        status: { $in: reservingStatuses },
        'services.serviceId': request.params.id,
      })
      if (activeAppointments) {
        return response.status(409).json({
          success: false,
          data: null,
          message: 'Không thể xóa dịch vụ đang được dùng trong lịch hẹn chưa hoàn tất.',
          code: 'SERVICE_IN_USE',
          meta: {},
        })
      }
      const service = await Service.findByIdAndUpdate(
        request.params.id,
        { isActive: false },
        { new: true },
      )
      if (!service) {
        return response.status(404).json({ success: false, data: null, message: 'Không tìm thấy dịch vụ.', code: 'NOT_FOUND', meta: {} })
      }
      response.json(success(service, 'Đã ngừng dịch vụ'))
    } catch (error) { next(error) }
  })

  api.route('/beds').get(async (request, response, next) => {
    try { response.json(success(await Bed.find().sort({ code: 1 }))) } catch (error) { next(error) }
  }).post(requireOwner, validate(z.object({ name: z.string().min(1), code: z.string().min(1), isActive: z.boolean().optional() })),
    async (request, response, next) => {
      try { response.status(201).json(success(await Bed.create(request.validatedBody))) } catch (error) { next(error) }
    })
  api.patch('/beds/:id', requireOwner, validate(z.object({ name: z.string().min(1).optional(), code: z.string().min(1).optional(), isActive: z.boolean().optional() })),
    async (request, response, next) => {
      try {
        const bed = await Bed.findByIdAndUpdate(request.params.id, request.validatedBody, { new: true, runValidators: true })
        if (!bed) return response.status(404).json({ success: false, data: null, message: 'Không tìm thấy giường.', code: 'NOT_FOUND', meta: {} })
        response.json(success(bed))
      } catch (error) { next(error) }
    })

  api.route('/staff-schedules').get(async (request, response, next) => {
    try { response.json(success(await StaffSchedule.find().populate('staffId').sort({ dayOfWeek: 1, startTime: 1 }))) } catch (error) { next(error) }
  }).post(requireOwner, validate(z.object({ staffId: z.string(), dayOfWeek: z.number().int().min(1).max(7), startTime: z.string(), endTime: z.string(), effectiveFrom: z.string().optional(), effectiveTo: z.string().optional() })),
    async (request, response, next) => {
      try { response.status(201).json(success(await StaffSchedule.create(request.validatedBody))) } catch (error) { next(error) }
    })

  api.route('/staff-time-offs').get(async (request, response, next) => {
    try { response.json(success(await StaffTimeOff.find().populate('staffId').sort({ startAt: 1 }))) } catch (error) { next(error) }
  }).post(validate(z.object({ staffId: z.string(), startAt: z.string(), endAt: z.string(), reason: z.string().optional() })),
    async (request, response, next) => {
      try {
        const body = request.validatedBody
        response.status(201).json(success(await StaffTimeOff.create({ ...body, startAt: new Date(body.startAt), endAt: new Date(body.endAt), createdBy: request.user._id })))
      } catch (error) { next(error) }
    })

  api.route('/settings/concurrency').get(async (request, response, next) => {
    try { response.json(success(await ensureSettings())) } catch (error) { next(error) }
  }).put(requireOwner, validate(z.object({ defaultMaxConcurrentCustomers: z.number().int().min(1).max(2) })),
    async (request, response, next) => {
      try {
        const settings = await ensureSettings()
        settings.defaultMaxConcurrentCustomers = request.validatedBody.defaultMaxConcurrentCustomers
        await settings.save()
        response.json(success(settings))
      } catch (error) { next(error) }
    })

  api.route('/capacity-overrides').get(async (request, response, next) => {
    try { response.json(success(await CapacityOverride.find().populate('createdBy', 'fullName').sort({ startAt: 1 }))) } catch (error) { next(error) }
  }).post(requireOwner, validate(z.object({ startAt: z.string(), endAt: z.string(), maxConcurrentCustomers: z.number().int().min(1).max(2), reason: z.string().min(1) })),
    async (request, response, next) => {
      try {
        const body = request.validatedBody
        const startAt = new Date(body.startAt)
        const endAt = new Date(body.endAt)
        if (endAt <= startAt) return response.status(400).json({ success: false, data: null, message: 'Thời gian kết thúc không hợp lệ.', code: 'VALIDATION_ERROR', meta: {} })
        if (body.maxConcurrentCustomers === 2) {
          const activeBeds = await Bed.countDocuments({ isActive: true })
          const activeProviders = await StaffProfile.countDocuments({ isActive: true, isServiceProvider: true })
          if (activeBeds < 2 || activeProviders < 2) {
            return conflict(response, 'Không thể bật 2 khách đồng thời: cần ít nhất 2 giường và 2 nhân viên đang hoạt động.')
          }
        }
        const override = await CapacityOverride.create({ ...body, startAt, endAt, createdBy: request.user._id })
        response.status(201).json(success(override))
      } catch (error) { next(error) }
    })

  api.get('/availability', async (request, response, next) => {
    try {
      const { startAt, durationMinutes, staffId } = request.query
      if (!startAt || !durationMinutes) return response.status(400).json({ success: false, data: null, message: 'Cần startAt và durationMinutes.', code: 'VALIDATION_ERROR', meta: {} })
      const start = new Date(startAt)
      const { occupiedEndAt } = safeInterval(start, Number(durationMinutes), 0)
      const staffFilter = staffId ? { _id: staffId } : {}
      const staff = await StaffProfile.find({ ...staffFilter, isActive: true, isServiceProvider: true })
      const beds = await Bed.find({ isActive: true })
      const overlap = overlapFilter(start, occupiedEndAt)
      const eligibleProviders = []
      for (const provider of staff) {
        if (!(await Appointment.exists({ ...overlap, staffId: provider._id }))) eligibleProviders.push(provider)
      }
      const eligibleBeds = []
      for (const bed of beds) {
        if (!(await Appointment.exists({ ...overlap, bedId: bed._id }))) eligibleBeds.push(bed)
      }
      const concurrent = await Appointment.countDocuments(overlap)
      const remainingCapacity = Math.max(0, await getActiveCapacity(start, occupiedEndAt) - concurrent)
      response.json(success({ providers: eligibleProviders, beds: eligibleBeds, remainingCapacity }))
    } catch (error) { next(error) }
  })

  api.route('/appointments').get(async (request, response, next) => {
    try {
      const filter = {}
      if (request.query.from) filter.occupiedStartAt = { $gte: new Date(request.query.from) }
      if (request.query.to) filter.occupiedEndAt = { ...(filter.occupiedEndAt || {}), $lte: new Date(request.query.to) }
      if (request.query.staffId) filter.staffId = request.query.staffId
      if (request.query.bedId) filter.bedId = request.query.bedId
      if (request.query.status) filter.status = request.query.status
      if (request.query.keyword) {
        const customerIds = await Customer.find({ $or: [{ fullName: { $regex: request.query.keyword, $options: 'i' } }, { phone: { $regex: request.query.keyword, $options: 'i' } }] }).distinct('_id')
        filter.customerId = { $in: customerIds }
      }
      const page = Math.max(1, Number(request.query.page) || 1)
      const limit = Math.min(200, Math.max(1, Number(request.query.limit) || 100))
      const [items, total] = await Promise.all([
        Appointment.find(filter).populate('customerId').populate('staffId').populate('bedId').sort({ startAt: 1 }).skip((page - 1) * limit).limit(limit),
        Appointment.countDocuments(filter),
      ])
      response.json(success(items, 'OK', { page, limit, total, pages: Math.ceil(total / limit) }))
    } catch (error) { next(error) }
  }).post(validate(z.object({
    customerName: z.string().min(1).optional(),
    customerPhone: z.string().min(1).optional(),
    customerId: z.string().optional(),
    staffId: z.string().optional(),
    bedId: z.string().optional(),
    startAt: z.string(),
    services: z.array(z.object({ serviceId: z.string(), estimatedDurationMinutes: z.number().int().min(1).optional() })).min(1).optional(),
    serviceId: z.string().optional(),
    serviceIds: z.array(z.string()).optional(),
    durationMode: z.enum(['AUTO', 'MANUAL']).default('AUTO'),
    estimatedDurationMinutes: z.number().int().min(1).optional(),
    bufferMinutes: z.number().int().min(0).default(0),
    notes: z.string().optional(),
  })), async (request, response, next) => {
    try {
      const body = request.validatedBody
      const selectedServices = body.services?.length
        ? body.services
        : body.serviceIds?.length
          ? body.serviceIds.map((serviceId) => ({ serviceId }))
        : body.serviceId
          ? [{ serviceId: body.serviceId, estimatedDurationMinutes: body.estimatedDurationMinutes }]
          : null
      if (!selectedServices) {
        return response.status(400).json({ success: false, data: null, message: 'Vui lòng chọn loại dịch vụ.', code: 'VALIDATION_ERROR', meta: {} })
      }

      let customer
      if (body.customerId) {
        customer = await Customer.findById(body.customerId)
      } else {
        if (!body.customerName || !body.customerPhone) {
          return response.status(400).json({ success: false, data: null, message: 'Vui lòng nhập tên khách hàng và số điện thoại.', code: 'VALIDATION_ERROR', meta: {} })
        }
        customer = await Customer.findOne({ phone: body.customerPhone })
        if (!customer) {
          customer = await Customer.create({ fullName: body.customerName, phone: body.customerPhone })
        } else if (body.customerName && customer.fullName !== body.customerName) {
          customer.fullName = body.customerName
          await customer.save()
        }
      }
      if (!customer) {
        return response.status(404).json({ success: false, data: null, message: 'Không tìm thấy khách hàng.', code: 'NOT_FOUND', meta: {} })
      }

      const serviceDocs = await Promise.all(selectedServices.map((item) => Service.findOne({ _id: item.serviceId, isActive: true })))
      if (serviceDocs.some((item) => !item)) return response.status(400).json({ success: false, data: null, message: 'Có dịch vụ không hoạt động.', code: 'VALIDATION_ERROR', meta: {} })
      const services = selectedServices.map((item, index) => {
        const service = serviceDocs[index]
        const estimated = item.estimatedDurationMinutes ?? service.defaultDurationMinutes
        return {
          serviceId: service._id,
          serviceNameSnapshot: service.name,
          priceSnapshot: service.defaultPrice,
          defaultDurationMinutes: service.defaultDurationMinutes,
          estimatedDurationMinutes: estimated,
        }
      })
      const summedDuration = services.reduce((sum, service) => sum + service.estimatedDurationMinutes, 0)
      const estimatedDuration = body.durationMode === 'MANUAL'
        ? (body.estimatedDurationMinutes ?? summedDuration)
        : summedDuration
      const interval = safeInterval(body.startAt, estimatedDuration, body.bufferMinutes)

      let staffId = body.staffId
      let bedId = body.bedId
      if (!staffId) {
        const ownProfile = await StaffProfile.findOne({ userId: request.user._id, isActive: true, isServiceProvider: true })
        if (ownProfile) staffId = ownProfile._id
      }
      if (!staffId) {
        const overlap = overlapFilter(interval.startAt, interval.occupiedEndAt)
        const staffProfiles = await StaffProfile.find({ isActive: true, isServiceProvider: true })
        for (const profile of staffProfiles) {
          if (!(await Appointment.exists({ ...overlap, staffId: profile._id }))) {
            staffId = profile._id
            break
          }
        }
      }
      if (!bedId) {
        const overlap = overlapFilter(interval.startAt, interval.occupiedEndAt)
        const beds = await Bed.find({ isActive: true }).sort({ code: 1 })
        for (const bed of beds) {
          if (!(await Appointment.exists({ ...overlap, bedId: bed._id }))) {
            bedId = bed._id
            break
          }
        }
      }
      if (!staffId || !bedId) {
        return conflict(response, 'Không còn nhân viên hoặc giường khả dụng trong khung giờ này.')
      }

      const lockKey = `provider:${staffId}:${new Date(body.startAt).toISOString().slice(0, 13)}`
      const lock = await BookingLock.findOneAndUpdate(
        { key: lockKey, expiresAt: { $gt: new Date() } },
        { $set: { expiresAt: new Date(Date.now() + 15_000) } },
        { new: true },
      )
      if (lock) return conflict(response)
      await BookingLock.findOneAndUpdate(
        { key: lockKey },
        { key: lockKey, expiresAt: new Date(Date.now() + 15_000) },
        { upsert: true, new: true },
      )
      try {
        const resourceError = await checkAppointmentResources({ staffId, bedId, startAt: interval.startAt, occupiedEndAt: interval.occupiedEndAt })
        if (resourceError) return conflict(response, resourceError)
        const appointment = await Appointment.create({
          ...body,
          customerId: customer._id,
          staffId,
          bedId,
          ...interval,
          services,
          estimatedDurationMinutes: estimatedDuration,
          createdBy: request.user._id,
          updatedBy: request.user._id,
        })
        await AppointmentHistory.create({ appointmentId: appointment._id, changedBy: request.user._id, action: 'CREATED', newValues: appointment.toObject() })
        response.status(201).json(success(appointment))
      } finally {
        await BookingLock.deleteOne({ key: lockKey })
      }
    } catch (error) { next(error) }
  })

  api.get('/appointments/:id', async (request, response, next) => {
    try {
      const appointment = await Appointment.findById(request.params.id).populate('customerId').populate('staffId').populate('bedId')
      if (!appointment) return response.status(404).json({ success: false, data: null, message: 'Không tìm thấy lịch hẹn.', code: 'NOT_FOUND', meta: {} })
      const history = await AppointmentHistory.find({ appointmentId: appointment._id }).populate('changedBy', 'fullName').sort({ createdAt: -1 })
      response.json(success({ appointment, history }))
    } catch (error) { next(error) }
  })

  api.patch('/appointments/:id', validate(z.object({
    customerName: z.string().min(1).optional(),
    customerPhone: z.string().min(1).optional(),
    startAt: z.string().optional(),
    serviceId: z.string().optional(),
    serviceIds: z.array(z.string()).optional(),
    estimatedDurationMinutes: z.number().int().min(1).optional(),
    notes: z.string().optional(),
  })), async (request, response, next) => {
    try {
      const oldAppointment = await Appointment.findById(request.params.id)
      if (!oldAppointment) return response.status(404).json({ success: false, data: null, message: 'Không tìm thấy lịch hẹn.', code: 'NOT_FOUND', meta: {} })
      const customer = await Customer.findById(oldAppointment.customerId)
      if (!customer) return response.status(404).json({ success: false, data: null, message: 'Không tìm thấy khách hàng.', code: 'NOT_FOUND', meta: {} })
      if (request.validatedBody.customerName) {
        customer.fullName = request.validatedBody.customerName
      }
      if (request.validatedBody.customerPhone) {
        customer.phone = request.validatedBody.customerPhone
      }
      await customer.save()

      let services = oldAppointment.services
      const serviceIds = request.validatedBody.serviceIds?.length
        ? request.validatedBody.serviceIds
        : request.validatedBody.serviceId
          ? [request.validatedBody.serviceId]
          : null
      if (serviceIds) {
        const serviceDocs = await Promise.all(serviceIds.map((serviceId) => Service.findOne({ _id: serviceId, isActive: true })))
        if (serviceDocs.some((service) => !service)) {
          return response.status(400).json({ success: false, data: null, message: 'Có dịch vụ không hoạt động.', code: 'VALIDATION_ERROR', meta: {} })
        }
        const summed = serviceDocs.reduce((sum, service) => sum + service.defaultDurationMinutes, 0)
        services = serviceDocs.map((service) => ({
          serviceId: service._id,
          serviceNameSnapshot: service.name,
          priceSnapshot: service.defaultPrice,
          defaultDurationMinutes: service.defaultDurationMinutes,
          estimatedDurationMinutes: service.defaultDurationMinutes,
        }))
        if (!request.validatedBody.estimatedDurationMinutes) {
          request.validatedBody.estimatedDurationMinutes = summed
        }
      }

      const duration = request.validatedBody.estimatedDurationMinutes
        || (serviceIds ? services.reduce((sum, service) => sum + service.estimatedDurationMinutes, 0) : oldAppointment.estimatedDurationMinutes)
      const startAt = request.validatedBody.startAt
        ? new Date(request.validatedBody.startAt)
        : oldAppointment.startAt
      const interval = safeInterval(startAt, duration, oldAppointment.bufferMinutes)
      const staffId = oldAppointment.staffId
      const bedId = oldAppointment.bedId
      const resourceError = await checkAppointmentResources({ staffId, bedId, startAt: interval.startAt, occupiedEndAt: interval.occupiedEndAt, excludeId: oldAppointment._id })
      if (resourceError) return conflict(response, resourceError)
      const appointment = await Appointment.findByIdAndUpdate(
        request.params.id,
        {
          ...interval,
          services,
          estimatedDurationMinutes: duration,
          durationMode: 'MANUAL',
          notes: request.validatedBody.notes ?? oldAppointment.notes,
          updatedBy: request.user._id,
        },
        { new: true, runValidators: true },
      )
      await AppointmentHistory.create({ appointmentId: appointment._id, changedBy: request.user._id, action: 'UPDATED', oldValues: oldAppointment.toObject(), newValues: appointment.toObject() })
      response.json(success(appointment))
    } catch (error) { next(error) }
  })

  api.post('/appointments/:id/services', validate(z.object({ serviceId: z.string(), estimatedDurationMinutes: z.number().int().min(1).optional(), durationChoice: z.enum(['KEEP', 'RECALCULATE']).optional() })),
    async (request, response, next) => {
      try {
        const appointment = await Appointment.findById(request.params.id)
        if (!appointment) return response.status(404).json({ success: false, data: null, message: 'Không tìm thấy lịch hẹn.', code: 'NOT_FOUND', meta: {} })
        if (!['CONFIRMED', 'ARRIVED', 'IN_PROGRESS'].includes(appointment.status)) return response.status(409).json({ success: false, data: null, message: 'Chỉ có thể thêm dịch vụ cho lịch chưa hoàn tất.', code: 'INVALID_STATUS', meta: {} })
        const service = await Service.findOne({ _id: request.validatedBody.serviceId, isActive: true })
        if (!service) return response.status(404).json({ success: false, data: null, message: 'Không tìm thấy dịch vụ hoạt động.', code: 'NOT_FOUND', meta: {} })
        const item = {
          serviceId: service._id,
          serviceNameSnapshot: service.name,
          priceSnapshot: service.defaultPrice,
          defaultDurationMinutes: service.defaultDurationMinutes,
          estimatedDurationMinutes: request.validatedBody.estimatedDurationMinutes ?? service.defaultDurationMinutes,
        }
        const oldServices = appointment.services
        const services = [...oldServices, item]
        const summedDuration = services.reduce((sum, line) => sum + line.estimatedDurationMinutes, 0)
        if (appointment.durationMode === 'MANUAL' && !request.validatedBody.durationChoice) {
          return response.status(409).json({
            success: false,
            data: { currentManualEstimate: appointment.estimatedDurationMinutes, recalculatedEstimate: summedDuration },
            message: 'Lịch hẹn đang dùng thời gian ước tính thủ công. Chọn giữ hoặc tính lại.',
            code: 'MANUAL_DURATION_CHOICE_REQUIRED',
            meta: {},
          })
        }
        const estimatedDuration = appointment.durationMode === 'MANUAL' && request.validatedBody.durationChoice === 'KEEP'
          ? appointment.estimatedDurationMinutes
          : summedDuration
        const interval = safeInterval(appointment.startAt, estimatedDuration, appointment.bufferMinutes)
        const resourceError = await checkAppointmentResources({ staffId: appointment.staffId, bedId: appointment.bedId, startAt: interval.startAt, occupiedEndAt: interval.occupiedEndAt, excludeId: appointment._id })
        if (resourceError) return conflict(response, resourceError)
        const oldValues = appointment.toObject()
        appointment.services = services
        appointment.estimatedDurationMinutes = estimatedDuration
        Object.assign(appointment, interval, { updatedBy: request.user._id })
        await appointment.save()
        await AppointmentHistory.create({ appointmentId: appointment._id, changedBy: request.user._id, action: 'SERVICE_ADDED', oldValues, newValues: appointment.toObject(), reason: 'Thêm dịch vụ trong buổi phục vụ' })
        response.json(success(appointment))
      } catch (error) { next(error) }
    })

  api.patch('/appointments/:id/duration', validate(z.object({ estimatedDurationMinutes: z.number().int().min(1), bufferMinutes: z.number().int().min(0).optional() })),
    async (request, response, next) => {
      try {
        const appointment = await Appointment.findById(request.params.id)
        if (!appointment) return response.status(404).json({ success: false, data: null, message: 'Không tìm thấy lịch hẹn.', code: 'NOT_FOUND', meta: {} })
        const bufferMinutes = request.validatedBody.bufferMinutes ?? appointment.bufferMinutes
        const interval = safeInterval(appointment.startAt, request.validatedBody.estimatedDurationMinutes, bufferMinutes)
        const resourceError = await checkAppointmentResources({ staffId: appointment.staffId, bedId: appointment.bedId, startAt: interval.startAt, occupiedEndAt: interval.occupiedEndAt, excludeId: appointment._id })
        if (resourceError) return conflict(response, resourceError)
        const oldValues = appointment.toObject()
        Object.assign(appointment, interval, { estimatedDurationMinutes: request.validatedBody.estimatedDurationMinutes, durationMode: 'MANUAL', bufferMinutes, updatedBy: request.user._id })
        await appointment.save()
        await AppointmentHistory.create({ appointmentId: appointment._id, changedBy: request.user._id, action: 'DURATION_CHANGED', oldValues, newValues: appointment.toObject() })
        response.json(success(appointment))
      } catch (error) { next(error) }
    })

  api.patch('/appointments/:id/reschedule', validate(z.object({ startAt: z.string(), staffId: z.string().optional(), bedId: z.string().optional() })),
    async (request, response, next) => {
      try {
        const appointment = await Appointment.findById(request.params.id)
        if (!appointment) return response.status(404).json({ success: false, data: null, message: 'Không tìm thấy lịch hẹn.', code: 'NOT_FOUND', meta: {} })
        const interval = safeInterval(request.validatedBody.startAt, appointment.estimatedDurationMinutes, appointment.bufferMinutes)
        const staffId = request.validatedBody.staffId || appointment.staffId
        const bedId = request.validatedBody.bedId || appointment.bedId
        const resourceError = await checkAppointmentResources({ staffId, bedId, startAt: interval.startAt, occupiedEndAt: interval.occupiedEndAt, excludeId: appointment._id })
        if (resourceError) return conflict(response, resourceError)
        const oldValues = appointment.toObject()
        Object.assign(appointment, interval, { staffId, bedId, updatedBy: request.user._id })
        await appointment.save()
        await AppointmentHistory.create({ appointmentId: appointment._id, changedBy: request.user._id, action: 'RESCHEDULED', oldValues, newValues: appointment.toObject() })
        response.json(success(appointment))
      } catch (error) { next(error) }
    })

  api.patch('/appointments/:id/status', validate(z.object({ status: z.enum(['CONFIRMED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW']), reason: z.string().optional() })),
    async (request, response, next) => {
      try {
        const appointment = await Appointment.findById(request.params.id)
        if (!appointment) return response.status(404).json({ success: false, data: null, message: 'Không tìm thấy lịch hẹn.', code: 'NOT_FOUND', meta: {} })
        const oldValues = appointment.toObject()
        appointment.status = request.validatedBody.status
        if (request.validatedBody.status === 'IN_PROGRESS' && !appointment.actualStartAt) {
          appointment.actualStartAt = new Date()
        }
        if (request.validatedBody.status === 'COMPLETED' && !appointment.actualEndAt) {
          appointment.actualEndAt = new Date()
        }
        appointment.updatedBy = request.user._id
        await appointment.save()
        await AppointmentHistory.create({ appointmentId: appointment._id, changedBy: request.user._id, action: `STATUS_${request.validatedBody.status}`, oldValues, newValues: appointment.toObject(), reason: request.validatedBody.reason })
        response.json(success(appointment))
      } catch (error) { next(error) }
    })

  api.get('/dashboard/summary', async (request, response, next) => {
    try {
      const todayStart = new Date()
      todayStart.setHours(0, 0, 0, 0)
      const todayEnd = new Date(todayStart)
      todayEnd.setDate(todayEnd.getDate() + 1)
      const [today, upcoming, inProgress, completed, cancelled, noShow] = await Promise.all([
        Appointment.countDocuments({ startAt: { $gte: todayStart, $lt: todayEnd } }),
        Appointment.countDocuments({ status: 'CONFIRMED', startAt: { $gte: new Date() } }),
        Appointment.find({ status: 'IN_PROGRESS' }).populate('customerId staffId bedId'),
        Appointment.countDocuments({ status: 'COMPLETED', startAt: { $gte: todayStart, $lt: todayEnd } }),
        Appointment.countDocuments({ status: 'CANCELLED', startAt: { $gte: todayStart, $lt: todayEnd } }),
        Appointment.countDocuments({ status: 'NO_SHOW', startAt: { $gte: todayStart, $lt: todayEnd } }),
      ])
      const settings = await ensureSettings()
      const nowAppointments = await Appointment.countDocuments({ status: { $in: reservingStatuses }, occupiedStartAt: { $lte: new Date() }, occupiedEndAt: { $gt: new Date() } })
      const completedToday = await Appointment.find({ status: 'COMPLETED', startAt: { $gte: todayStart, $lt: todayEnd } })
      const revenue = completedToday.reduce((sum, appointment) => sum + appointment.services.reduce((lineSum, line) => lineSum + line.priceSnapshot, 0), 0)
      response.json(success({
        appointmentsToday: today,
        upcoming,
        inProgress,
        completed,
        cancelled,
        noShow,
        currentConcurrentCustomers: nowAppointments,
        configuredCapacity: settings.defaultMaxConcurrentCustomers,
        revenueToday: request.user.role === 'OWNER' ? revenue : null,
        beds: await Bed.countDocuments({ isActive: true }),
        providers: await StaffProfile.countDocuments({ isActive: true, isServiceProvider: true }),
      }))
    } catch (error) { next(error) }
  })

  api.get('/reports/appointments', async (request, response, next) => {
    try {
      const from = new Date(request.query.from || new Date(Date.now() - 30 * 86_400_000))
      const to = new Date(request.query.to || Date.now())
      const appointments = await Appointment.find({ startAt: { $gte: from, $lte: to } }).populate('services.serviceId')
      response.json(success({ total: appointments.length, from, to, appointments }))
    } catch (error) { next(error) }
  })
  api.get('/reports/revenue', requireOwner, async (request, response, next) => {
    try {
      const from = new Date(request.query.from || new Date(Date.now() - 30 * 86_400_000))
      const to = new Date(request.query.to || Date.now())
      const appointments = await Appointment.find({ status: 'COMPLETED', startAt: { $gte: from, $lte: to } })
      const revenue = appointments.reduce((sum, appointment) => sum + appointment.services.reduce((lineSum, line) => lineSum + line.priceSnapshot, 0), 0)
      response.json(success({ revenue, completedAppointments: appointments.length, currency: 'VND', from, to, definition: 'Revenue is the sum of saved service price snapshots for COMPLETED appointments.' }))
    } catch (error) { next(error) }
  })
  api.get('/reports/services', async (request, response, next) => {
    try {
      const appointments = await Appointment.find({ status: 'COMPLETED' })
      const totals = new Map()
      for (const appointment of appointments) {
        for (const line of appointment.services) {
          const key = String(line.serviceId)
          const current = totals.get(key) || { serviceName: line.serviceNameSnapshot, count: 0, revenue: 0 }
          current.count += 1
          current.revenue += line.priceSnapshot
          totals.set(key, current)
        }
      }
      response.json(success([...totals.values()].sort((a, b) => b.count - a.count)))
    } catch (error) { next(error) }
  })
  api.get('/reports/staff-performance', async (request, response, next) => {
    try {
      const appointments = await Appointment.find().populate('staffId')
      const totals = new Map()
      for (const appointment of appointments) {
        const key = String(appointment.staffId?._id || appointment.staffId)
        const name = appointment.staffId?.displayName || 'Không xác định'
        const current = totals.get(key) || { staffName: name, appointments: 0, completed: 0 }
        current.appointments += 1
        if (appointment.status === 'COMPLETED') current.completed += 1
        totals.set(key, current)
      }
      response.json(success([...totals.values()]))
    } catch (error) { next(error) }
  })
  api.get('/reports/customers', async (request, response, next) => {
    try {
      const appointments = await Appointment.find().populate('customerId')
      const totals = new Map()
      for (const appointment of appointments) {
        const key = String(appointment.customerId?._id || appointment.customerId)
        const name = appointment.customerId?.fullName || 'Không xác định'
        const current = totals.get(key) || { customerName: name, visits: 0, completedVisits: 0 }
        current.visits += 1
        if (appointment.status === 'COMPLETED') current.completedVisits += 1
        totals.set(key, current)
      }
      response.json(success([...totals.values()].sort((a, b) => b.visits - a.visits)))
    } catch (error) { next(error) }
  })

  app.use('/api/v1', api)

  app.use((request, response) => {
    response.status(404).json({ success: false, data: null, message: 'Không tìm thấy đường dẫn.', code: 'NOT_FOUND', requestId: request.requestId, meta: {} })
  })
  app.use((error, request, response, next) => {
    if (error?.code === 11000) {
      return response.status(409).json({ success: false, data: null, message: 'Dữ liệu trùng lặp.', code: 'CONFLICT', meta: {} })
    }
    console.error(error)
    response.status(500).json({
      success: false,
      data: null,
      message: 'Lỗi máy chủ.',
      code: 'INTERNAL_ERROR',
      meta: {
        errorName: error?.name || null,
        errorCode: typeof error?.code === 'string' ? error.code : null,
      },
    })
  })

  return app
}
