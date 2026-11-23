import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { createApp } from '../src/app.js'
import { connectDatabase } from '../src/config/db.js'
import { Bed, Service, SpaSettings, StaffProfile, User } from '../src/models/index.js'

let initialized

async function initialize() {
  await connectDatabase()

  await SpaSettings.updateOne(
    {},
    {
      $setOnInsert: {
        spaName: 'LEMN SPA',
        timezone: 'Asia/Ho_Chi_Minh',
        currency: 'VND',
        totalBeds: 2,
        defaultMaxConcurrentCustomers: 1,
        absoluteMaxConcurrentCustomers: 2,
        defaultBufferMinutes: 0,
      },
    },
    { upsert: true },
  )

  await Bed.bulkWrite([
    { updateOne: { filter: { code: 'BED-1' }, update: { $setOnInsert: { name: 'Bed 1', code: 'BED-1', isActive: true } }, upsert: true } },
    { updateOne: { filter: { code: 'BED-2' }, update: { $setOnInsert: { name: 'Bed 2', code: 'BED-2', isActive: true } }, upsert: true } },
  ])

  await Service.bulkWrite([
    { updateOne: { filter: { name: 'CHĂM SÓC DA CƠ BẢN' }, update: { $setOnInsert: { name: 'CHĂM SÓC DA CƠ BẢN', description: 'Làm sạch sâu, lấy nhân mụn chuẩn y khoa, cấp ẩm phục hồi giúp da khoẻ mạnh, tươi sáng.', defaultPrice: 199000, defaultDurationMinutes: 60, isActive: true } }, upsert: true } },
    { updateOne: { filter: { name: 'CHĂM SÓC DA CHUYÊN SÂU' }, update: { $setOnInsert: { name: 'CHĂM SÓC DA CHUYÊN SÂU', description: 'Kiểm soát dầu nhờn, chống viêm nhiễm, hạn chế mụn quay lại.', defaultPrice: 299000, defaultDurationMinutes: 75, isActive: true } }, upsert: true } },
    { updateOne: { filter: { name: 'CHĂM SÓC DA PHỤC HỒI' }, update: { $setOnInsert: { name: 'CHĂM SÓC DA PHỤC HỒI', description: 'Làm dịu và giảm căng thẳng da, hỗ trợ tái tạo và phục hồi.', defaultPrice: 499000, defaultDurationMinutes: 90, isActive: true } }, upsert: true } },
    { updateOne: { filter: { name: 'VI TẢO THẢO MỘC CHRISTINA 4A' }, update: { $setOnInsert: { name: 'VI TẢO THẢO MỘC CHRISTINA 4A', description: 'Thanh lọc da, kháng viêm, giảm mụn, nuôi dưỡng làn da.', defaultPrice: 449000, defaultDurationMinutes: 90, isActive: true } }, upsert: true } },
    { updateOne: { filter: { name: 'THANH LỌC DA KHOÁNG SÉT' }, update: { $setOnInsert: { name: 'THANH LỌC DA KHOÁNG SÉT', description: 'Thải độc da, hút sạch bã nhờn, làm sạch lỗ chân lông.', defaultPrice: 549000, defaultDurationMinutes: 90, isActive: true } }, upsert: true } },
    { updateOne: { filter: { name: 'Ủ TRẮNG DA AHOHWA' }, update: { $setOnInsert: { name: 'Ủ TRẮNG DA AHOHWA', description: 'Nuôi dưỡng và làm sáng da, cải thiện sắc tố.', defaultPrice: 299000, defaultDurationMinutes: 60, isActive: true } }, upsert: true } },
  ])

  if (process.env.OWNER_EMAIL && process.env.OWNER_PASSWORD) {
    let owner = await User.findOne({ email: process.env.OWNER_EMAIL.toLowerCase() })
    if (!owner) {
      owner = await User.create({
        email: process.env.OWNER_EMAIL,
        passwordHash: await bcrypt.hash(process.env.OWNER_PASSWORD, 12),
        fullName: 'Spa Owner',
        role: 'OWNER',
        isActive: true,
      })
    }
    await StaffProfile.updateOne(
      { userId: owner._id },
      { $setOnInsert: { userId: owner._id, displayName: 'Spa Owner', isServiceProvider: true, isActive: true } },
      { upsert: true },
    )
  }
}

const app = createApp()

export default async function handler(request, response) {
  try {
    initialized ||= initialize()
    await initialized
    return app(request, response)
  } catch (error) {
    console.error('Serverless initialization failed:', error)

    let code = 'SERVERLESS_INITIALIZATION_FAILED'
    let message = 'Dịch vụ chưa sẵn sàng.'
    if (/MONGODB_URI is required/i.test(error?.message || '') || /MONGODB_URI/.test(error?.message || '')) {
      code = 'MONGODB_CONFIGURATION_ERROR'
      message = 'Thiếu hoặc sai cấu hình MONGODB_URI trên Vercel.'
    } else if (/authentication failed/i.test(error?.message || '') || error?.code === 8000) {
      code = 'MONGODB_AUTH_ERROR'
      message = 'MongoDB Atlas từ chối username hoặc password.'
    } else if (/ENODATA|querySrv/i.test(error?.message || '') || error?.code === 'ENODATA') {
      code = 'MONGODB_DNS_ERROR'
      message = 'Không tra cứu được cluster MongoDB Atlas.'
    }

    return response.status(503).json({
      success: false,
      data: null,
      message,
      code,
      meta: {},
    })
  }
}
