export function success(data, message = 'OK', meta = {}) {
  return { success: true, data, message, code: 'SUCCESS', meta }
}

export function overlapFilter(startAt, endAt) {
  return {
    status: { $in: ['CONFIRMED', 'ARRIVED', 'IN_PROGRESS'] },
    occupiedStartAt: { $lt: endAt },
    occupiedEndAt: { $gt: startAt },
  }
}

export function conflict(response, message = 'Khung giờ không còn khả dụng. Vui lòng tải lại lịch.') {
  return response.status(409).json({
    success: false,
    data: null,
    message,
    code: 'APPOINTMENT_RESOURCE_CONFLICT',
    meta: {},
  })
}
