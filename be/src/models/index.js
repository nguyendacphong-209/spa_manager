import mongoose from 'mongoose'

const { Schema } = mongoose
const ref = (name, required = true) => ({
  type: Schema.Types.ObjectId,
  ref: name,
  required,
})

const timestamps = { timestamps: true }

export const User = mongoose.model(
  'User',
  new Schema(
    {
      email: { type: String, required: true, unique: true, lowercase: true, trim: true },
      passwordHash: { type: String, required: true, select: false },
      fullName: { type: String, required: true },
      role: { type: String, enum: ['OWNER', 'STAFF'], default: 'STAFF' },
      isActive: { type: Boolean, default: true },
    },
    timestamps,
  ),
)

export const StaffProfile = mongoose.model(
  'StaffProfile',
  new Schema(
    {
      userId: ref('User'),
      displayName: { type: String, required: true },
      phone: String,
      isServiceProvider: { type: Boolean, default: true },
      isActive: { type: Boolean, default: true },
    },
    timestamps,
  ).index({ userId: 1 }, { unique: true }),
)

export const Customer = mongoose.model(
  'Customer',
  new Schema(
    {
      fullName: { type: String, required: true, trim: true },
      phone: { type: String, required: true, trim: true },
      email: { type: String, trim: true, lowercase: true },
      notes: { type: String, default: '' },
    },
    timestamps,
  ).index({ phone: 1 }).index({ fullName: 'text', phone: 'text' }),
)

export const Service = mongoose.model(
  'Service',
  new Schema(
    {
      name: { type: String, required: true },
      description: { type: String, default: '' },
      defaultPrice: { type: Number, required: true, min: 0 },
      defaultDurationMinutes: { type: Number, required: true, min: 1 },
      isActive: { type: Boolean, default: true },
    },
    timestamps,
  ),
)

export const StaffService = mongoose.model(
  'StaffService',
  new Schema(
    {
      staffId: ref('StaffProfile'),
      serviceId: ref('Service'),
    },
    timestamps,
  ).index({ staffId: 1, serviceId: 1 }, { unique: true }),
)

export const Bed = mongoose.model(
  'Bed',
  new Schema(
    {
      name: { type: String, required: true },
      code: { type: String, required: true, unique: true },
      isActive: { type: Boolean, default: true },
    },
    timestamps,
  ),
)

export const StaffSchedule = mongoose.model(
  'StaffSchedule',
  new Schema(
    {
      staffId: ref('StaffProfile'),
      dayOfWeek: { type: Number, min: 1, max: 7, required: true },
      startTime: { type: String, required: true },
      endTime: { type: String, required: true },
      effectiveFrom: Date,
      effectiveTo: Date,
    },
    timestamps,
  ),
)

export const StaffTimeOff = mongoose.model(
  'StaffTimeOff',
  new Schema(
    {
      staffId: ref('StaffProfile'),
      startAt: { type: Date, required: true },
      endAt: { type: Date, required: true },
      reason: String,
      createdBy: ref('User'),
    },
    timestamps,
  ),
)

export const CapacityOverride = mongoose.model(
  'CapacityOverride',
  new Schema(
    {
      startAt: { type: Date, required: true },
      endAt: { type: Date, required: true },
      maxConcurrentCustomers: { type: Number, enum: [1, 2], required: true },
      reason: { type: String, required: true },
      createdBy: ref('User'),
    },
    timestamps,
  ),
)

export const SpaSettings = mongoose.model(
  'SpaSettings',
  new Schema(
    {
      spaName: { type: String, default: 'LEMN SPA' },
      phone: String,
      timezone: { type: String, default: 'Asia/Ho_Chi_Minh' },
      currency: { type: String, default: 'VND' },
      totalBeds: { type: Number, default: 2 },
      defaultMaxConcurrentCustomers: { type: Number, enum: [1, 2], default: 1 },
      absoluteMaxConcurrentCustomers: { type: Number, enum: [1, 2], default: 2 },
      defaultBufferMinutes: { type: Number, default: 0, min: 0 },
    },
    timestamps,
  ),
)

export const Appointment = mongoose.model(
  'Appointment',
  new Schema(
    {
      customerId: ref('Customer'),
      staffId: ref('StaffProfile'),
      bedId: ref('Bed'),
      services: [
        {
          serviceId: ref('Service'),
          serviceNameSnapshot: { type: String, required: true },
          priceSnapshot: { type: Number, required: true, min: 0 },
          defaultDurationMinutes: { type: Number, required: true, min: 1 },
          estimatedDurationMinutes: { type: Number, required: true, min: 1 },
        },
      ],
      durationMode: { type: String, enum: ['AUTO', 'MANUAL'], default: 'AUTO' },
      estimatedDurationMinutes: { type: Number, required: true, min: 1 },
      bufferMinutes: { type: Number, default: 0, min: 0 },
      startAt: { type: Date, required: true },
      estimatedEndAt: { type: Date, required: true },
      occupiedStartAt: { type: Date, required: true },
      occupiedEndAt: { type: Date, required: true },
      status: {
        type: String,
        enum: ['CONFIRMED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'],
        default: 'CONFIRMED',
      },
      actualStartAt: Date,
      actualEndAt: Date,
      notes: { type: String, default: '' },
      createdBy: ref('User'),
      updatedBy: ref('User'),
    },
    timestamps,
  )
    .index({ staffId: 1, occupiedStartAt: 1, occupiedEndAt: 1 })
    .index({ bedId: 1, occupiedStartAt: 1, occupiedEndAt: 1 })
    .index({ customerId: 1, occupiedStartAt: 1, occupiedEndAt: 1 }),
)

export const AppointmentHistory = mongoose.model(
  'AppointmentHistory',
  new Schema(
    {
      appointmentId: ref('Appointment'),
      changedBy: ref('User'),
      action: { type: String, required: true },
      oldValues: Schema.Types.Mixed,
      newValues: Schema.Types.Mixed,
      reason: String,
    },
    timestamps,
  ),
)

export const BookingLock = mongoose.model(
  'BookingLock',
  new Schema({
    key: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
  }),
)
