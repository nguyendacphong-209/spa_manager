# Backend API Examples

Base path: `/api/v1`

## Create an appointment
`POST /appointments`

```json
{
  "customerId": "665000000000000000000001",
  "staffId": "665000000000000000000002",
  "bedId": "665000000000000000000003",
  "startAt": "2026-11-24T02:00:00.000Z",
  "services": [
    { "serviceId": "665000000000000000000004", "estimatedDurationMinutes": 75 },
    { "serviceId": "665000000000000000000005", "estimatedDurationMinutes": 30 }
  ],
  "durationMode": "AUTO",
  "bufferMinutes": 10,
  "notes": "Khách có thể chọn thêm dịch vụ khi đến"
}
```

Backend loads authoritative service names/prices/default durations. The client must not submit authoritative price values.

For `AUTO`, total estimated duration is the sum of service item estimated durations: 105 minutes in this example. `estimatedEndAt = startAt + 105 minutes`; `occupiedEndAt = estimatedEndAt + 10 minutes`.

For `MANUAL`, the request also supplies `estimatedDurationMinutes`; backend validates it against configured limits and records who changed it.

## Add a service during the visit
`POST /appointments/:id/services`

```json
{
  "serviceId": "665000000000000000000006",
  "estimatedDurationMinutes": 20
}
```

If duration mode is AUTO, recalculate total duration and expected end time. If MANUAL, return both the current manual estimate and the new sum, and require an explicit keep/recalculate choice.

## Capacity policy
`PUT /settings/concurrency`

```json
{
  "defaultMaxConcurrentCustomers": 1
}
```

Only OWNER can change the global default.

Example date override:
`POST /capacity-overrides`

```json
{
  "startAt": "2026-11-24T02:00:00.000Z",
  "endAt": "2026-11-24T10:00:00.000Z",
  "maxConcurrentCustomers": 2,
  "reason": "Chủ spa cùng tham gia phục vụ"
}
```

Backend rejects values greater than 2 and rejects capacity 2 if there are not enough available beds/providers for the requested interval.

## Conflict response
HTTP `409`:
```json
{
  "success": false,
  "data": null,
  "message": "Khung giờ không còn khả dụng. Vui lòng tải lại lịch.",
  "code": "APPOINTMENT_RESOURCE_CONFLICT"
}
```
