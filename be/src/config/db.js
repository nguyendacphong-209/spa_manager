import mongoose from 'mongoose'

export async function connectDatabase(uri = process.env.MONGODB_URI) {
  if (!uri) {
    throw new Error('MONGODB_URI is required')
  }

  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10_000,
    })
    console.log(`MongoDB connected: ${mongoose.connection.host}`)
  } catch (error) {
    if (error?.code === 8000 || /authentication failed/i.test(error?.message || '')) {
      throw new Error(
        'MongoDB Atlas authentication failed. Kiểm tra Database User và mật khẩu trong MONGODB_URI.',
      )
    }

    if (
      error?.code === 'ENODATA' ||
      /querySrv ENODATA/i.test(error?.message || '')
    ) {
      throw new Error(
        'MongoDB Atlas SRV DNS lookup failed. Lấy lại connection string mới nhất từ Atlas; kiểm tra cluster có còn tồn tại, DNS/network không chặn mongodb.net.',
      )
    }

    throw error
  }
}
