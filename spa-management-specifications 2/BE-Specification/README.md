# Backend Specification — Spa Management System

**Version:** 2.0  
**Architecture:** MERN + TypeScript + MongoDB Atlas  
**Business scope:** 1 spa branch, normally 1 service provider (employee), with the owner able to work as a second service provider. The spa has 2 treatment beds.

## 1. Business goals

The system is an internal staff tool. Customers do not create accounts or book online in the MVP. Staff enter appointments on behalf of customers.

The core requirements are:
- Prevent a service provider from being assigned to overlapping appointments.
- Prevent a treatment bed from being assigned to overlapping appointments.
- Default to a maximum of **1 concurrent customer**.
- Allow the OWNER to temporarily enable a maximum of **2 concurrent customers** when there are enough available service providers and beds.
- Allow one appointment to contain multiple services.
- Estimate appointment duration by summing service durations, while allowing staff to adjust the total estimated duration for that appointment.
- Allow staff to add extra services after the customer arrives and recalculate the expected end time.
- Provide operational and business statistics.

## 2. Technology stack

- Node.js 22 LTS
- Express.js 5
- TypeScript
- MongoDB Atlas M0 + Mongoose
- Zod for request validation
- JWT authentication; bcrypt or Argon2 password hashing
- Swagger / OpenAPI
- Vitest or Jest + Supertest

## 3. Roles and service-provider model

### OWNER
- Full system access.
- Can create, deactivate and manage STAFF accounts.
- Can configure concurrency policy and spa settings.
- Can manage services, service providers, beds, schedules, appointments and reports.
- Can also be assigned as the service provider for an appointment.

### STAFF
- Can view the full calendar to avoid conflicts.
- Can create customers and appointments.
- Can select an available service provider, including the OWNER when the owner is working.
- Can add services to an appointment and adjust its estimated duration, subject to policy.
- Can update/cancel appointments according to permissions configured by OWNER.
- Cannot manage user accounts, global settings or owner-only revenue reports unless explicitly granted.

### Important modelling rule
Do not assume that an account with role `OWNER` is always only an administrator. A user may also have a `staffProfile` and be bookable as a service provider. The service-provider identity should be represented independently from the authorization role.

Recommended:
- `users.role`: `OWNER | STAFF`
- `staffProfiles.userId`: reference to a user who can perform services.
- A STAFF account normally has a staff profile.
- The OWNER may optionally have a staff profile; when the owner works, their profile is active and selectable in appointment assignment.

## 4. Core modules

| Module | Responsibility |
|---|---|
| auth | Login, refresh, logout, current user |
| users | User accounts, roles, active status |
| staff | Service-provider profiles and service skills |
| customers | Customer records and search |
| services | Service catalogue, default price and duration |
| beds | Two treatment beds and active status |
| schedules | Provider working shifts |
| time-offs | Provider leave / unavailable intervals |
| appointments | Appointment lifecycle and service items |
| availability | Provider + bed + concurrency availability |
| settings | Spa configuration and concurrency policy |
| dashboard | Operational summary |
| reports | Revenue, services, customers and utilization |

## 5. Concurrency policy

### Default configuration
```ts
{
  totalBeds: 2,
  defaultMaxConcurrentCustomers: 1,
  absoluteMaxConcurrentCustomers: 2,
  allowOwnerToEnableSecondConcurrentCustomer: true
}
```

### Required behavior
1. The system starts with a concurrency limit of **1**.
2. OWNER can enable a limit of **2** for a chosen operating period or business day. The exact UI may offer a simple "Allow 2 simultaneous customers" switch for the selected date/period.
3. The limit can never exceed the number of active beds or available service providers. For this spa, the hard maximum is 2.
4. Enabling capacity 2 does not itself make a second appointment valid. Each appointment still needs its own available provider and bed.
5. If only one provider is available, the system must not accept two appointments that require hands-on service at the same time.
6. If the OWNER is not working, their profile must not be counted as an available provider.
7. Existing confirmed appointments must not be silently deleted or moved when the capacity policy changes.
8. If the OWNER turns capacity back to 1 while two appointments overlap, warn that the current schedule exceeds the new preferred limit. Do not silently cancel either appointment. Block additional overlapping bookings until concurrency is back within policy, unless OWNER explicitly overrides with a recorded reason.

Recommended data model:
- `spaSettings`: global defaults.
- `capacityOverrides`: optional date/time-scoped override, with `maxConcurrentCustomers` restricted to 1 or 2, `startAt`, `endAt`, `createdBy`, `reason`.
- If keeping MVP simpler, store the override by business date rather than arbitrary interval, but make the chosen scope explicit.

## 6. Appointment and service-duration rules

### One appointment can contain multiple services
Example:
- Facial care: 60 minutes
- Face massage: 30 minutes
- Mask treatment: 20 minutes
- Estimated total: 110 minutes

Each appointment contains `services[]`. Each item stores a snapshot of the service name, price and default duration at the time it was added.

### Duration calculation — confirmed policy: SUM_EDIT
1. When a service is added, its default duration is copied from the service catalogue.
2. Staff may adjust the estimated duration of an individual service item if needed.
3. The default appointment duration is the sum of all service-item estimated durations.
4. Staff may also edit the total estimated duration for this specific appointment.
5. Store whether the appointment duration is automatic or manually overridden:
   - `AUTO`: total = sum of service item estimated durations.
   - `MANUAL`: total = staff-entered appointment duration.
6. When adding an extra service during the visit:
   - In `AUTO` mode, recalculate total from all service items.
   - In `MANUAL` mode, show the new summed estimate and ask staff whether to keep the manual total or use the recalculated total. Never silently overwrite a manual estimate.
7. The final expected end time is `startAt + estimatedDurationMinutes`.
8. Service catalogue changes must not rewrite existing appointment snapshots.
9. If actual duration tracking is later added, store `actualStartAt` and `actualEndAt` separately; do not overwrite the original estimate.

### Buffer time
For MVP, support an optional appointment-level cleanup/setup buffer. It is not part of customer treatment duration, but it occupies the provider and bed:
- `occupiedStartAt = startAt`
- `occupiedEndAt = estimatedEndAt + bufferMinutes`

Do not add a buffer twice if individual services also have buffer values. Prefer one clear rule: appointment-level buffer is the authoritative occupancy buffer in MVP.

## 7. Appointment resource validation and double-booking prevention

Every appointment reserves:
- exactly one service provider (`staffId`)
- exactly one bed (`bedId`)
- one customer slot against the active concurrency limit

A new appointment is valid only if:
1. The provider is active and scheduled to work for the entire occupied interval.
2. The provider can perform every selected service, if skill mapping is enabled.
3. The provider has no overlapping active appointment.
4. The selected bed is active and has no overlapping active appointment.
5. The number of simultaneous active appointments at every point in the requested interval stays within the configured concurrency limit.
6. The customer is not already booked for an overlapping appointment, unless OWNER explicitly allows it.
7. The interval is within the spa's opening hours and does not overlap provider time-off.

Use half-open intervals `[start, end)`, so an appointment ending at 10:00 and another starting at 10:00 do not overlap.

Active statuses that reserve resources:
- `PENDING` (only if the business chooses to hold pending appointments)
- `CONFIRMED`
- `IN_PROGRESS`

Non-reserving statuses:
- `COMPLETED`
- `CANCELLED`
- `REJECTED`
- `NO_SHOW`

For internal staff-entered bookings, the recommended default is to create appointments as `CONFIRMED`, not `PENDING`.

### Concurrency and race conditions
A preflight `findOne()` overlap query is not sufficient: two simultaneous requests can both pass and then insert.

Implement a serialized booking operation, for example:
- Use a transaction on Atlas replica-set deployment.
- Acquire a short-lived lock document with a unique key for the affected provider/time bucket or business date.
- Within the same transaction, re-check provider overlap, bed overlap and concurrent appointment count, then insert/update.
- Ensure lock acquisition is atomic and the lock cannot remain permanently after failures.
- Retry transient transaction errors safely.
- Return HTTP `409 Conflict` for resource conflicts or capacity reached.

An alternative is fixed time-slot inventory with unique indexes, but it must account for appointments with arbitrary start times and variable durations. Do not claim that `{ staffId, startAt }` unique index alone prevents interval overlap.

The concurrency test must issue two simultaneous booking requests for the same provider, bed, or last available capacity. The result must never exceed the configured limit.

## 8. MongoDB collections

### `users`
`_id, email(unique/lowercase), passwordHash, fullName, role(OWNER|STAFF), isActive, createdAt, updatedAt`

### `staffProfiles`
`_id, userId(ref users), displayName, phone, isServiceProvider, isActive, joinedAt`
The OWNER may have a staff profile. `isServiceProvider` and `isActive` determine whether the person can be assigned.

### `customers`
`_id, fullName, phone, email?, notes, createdAt, updatedAt`
Index phone and normalized name for search. Only enforce unique phone if the spa confirms a phone number cannot be shared.

### `services`
`_id, name, description, defaultPrice, defaultDurationMinutes, isActive, createdAt, updatedAt`
Do not mutate historical appointment snapshots when catalogue values change.

### `staffServices`
`_id, staffId, serviceId`; unique compound index `{ staffId: 1, serviceId: 1 }`.
If every provider can perform every service in the MVP, this collection may be deferred, but the validation layer should be ready for it.

### `beds`
`_id, name, code, isActive`
Seed two records, e.g. `Bed 1` and `Bed 2`. Do not hard-code bed IDs in application logic.

### `staffSchedules`
`_id, staffId, dayOfWeek(1–7), startTime("09:00"), endTime("17:00"), effectiveFrom?, effectiveTo?`
Allow multiple shifts per day.

### `staffTimeOffs`
`_id, staffId, startAt, endAt, reason, createdBy`

### `capacityOverrides`
`_id, startAt, endAt, maxConcurrentCustomers(1|2), reason, createdBy, createdAt`
Optional if the first release uses only a global default and per-day toggle.

### `appointments`
```ts
{
  _id: ObjectId,
  customerId: ObjectId,
  staffId: ObjectId,
  bedId: ObjectId,
  services: [{
    serviceId: ObjectId,
    serviceNameSnapshot: string,
    priceSnapshot: number,
    defaultDurationMinutes: number,
    estimatedDurationMinutes: number
  }],
  durationMode: "AUTO" | "MANUAL",
  estimatedDurationMinutes: number,
  bufferMinutes: number,
  startAt: Date,
  estimatedEndAt: Date,
  occupiedStartAt: Date,
  occupiedEndAt: Date,
  status: "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" |
          "CANCELLED" | "NO_SHOW",
  notes: string,
  createdBy: ObjectId,
  updatedBy: ObjectId,
  createdAt: Date,
  updatedAt: Date
}
```
For each service line, keep price and duration snapshots. The appointment total price is calculated from the line snapshots or stored as a snapshot total if discounts are introduced.

### `appointmentHistories`
`_id, appointmentId, changedBy, action, oldValues, newValues, reason?, createdAt`
Record service additions/removals, duration edits, provider/bed changes, reschedules and status changes.

### `spaSettings`
`_id, spaName, phone, timezone("Asia/Ho_Chi_Minh"), currency("VND"), totalBeds(2), defaultMaxConcurrentCustomers(1), absoluteMaxConcurrentCustomers(2), defaultBufferMinutes(0)`

## 9. Appointment lifecycle
Suggested statuses:
- `CONFIRMED`: appointment reserved.
- `IN_PROGRESS`: customer is currently receiving service; still reserves provider and bed.
- `COMPLETED`: service finished; no longer reserves resources.
- `CANCELLED`: cancelled; no longer reserves resources.
- `NO_SHOW`: customer did not arrive; no longer reserves resources.

Avoid `PENDING` unless an approval workflow is actually needed.

## 10. API contract — base `/api/v1`

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/auth/login` | Login |
| POST | `/auth/refresh` | Refresh token |
| POST | `/auth/logout` | Logout |
| GET | `/auth/me` | Current user |
| GET/POST | `/users` | List/create accounts (OWNER) |
| PATCH | `/users/:id/status` | Activate/deactivate account |
| GET/POST | `/staff` | List/create provider profiles |
| GET/POST | `/customers` | List/create customers |
| GET/PATCH | `/customers/:id` | Read/update customer |
| GET/POST | `/services` | List/create services |
| PATCH | `/services/:id` | Update service catalogue |
| GET/POST | `/beds` | List/create beds (OWNER) |
| PATCH | `/beds/:id` | Update bed status |
| GET/POST | `/staff-schedules` | Working shifts |
| GET/POST | `/staff-time-offs` | Provider time off |
| GET/PUT | `/settings/concurrency` | Read/update default concurrency |
| GET/POST | `/capacity-overrides` | Read/create time-scoped capacity override |
| GET | `/availability` | Check providers, beds and capacity |
| GET/POST | `/appointments` | List/create appointments |
| GET | `/appointments/:id` | Appointment detail |
| PATCH | `/appointments/:id` | Update appointment |
| POST | `/appointments/:id/services` | Add service to an appointment |
| PATCH | `/appointments/:id/duration` | Adjust estimated duration |
| PATCH | `/appointments/:id/reschedule` | Reschedule |
| PATCH | `/appointments/:id/status` | Change lifecycle status |
| GET | `/dashboard/summary` | Dashboard KPIs |
| GET | `/reports/appointments` | Appointment analytics |
| GET | `/reports/revenue` | Revenue analytics |
| GET | `/reports/services` | Service analytics |
| GET | `/reports/staff-performance` | Provider utilization/performance |
| GET | `/reports/customers` | New/returning customers |

`GET /appointments` supports `from`, `to`, `staffId`, `bedId`, `serviceId`, `status`, `keyword`, `page`, `limit`.

`GET /availability` accepts `startAt`, `durationMinutes`, optional `staffId`, and returns eligible providers, beds and remaining capacity. It is advisory only; create/update must repeat all checks atomically.

## 11. Statistics and definitions

### Dashboard
- Appointments today / upcoming.
- Completed, cancelled and no-show counts.
- Revenue today (OWNER only).
- Number of simultaneous customers by time.
- Bed utilization.
- Provider utilization.
- Upcoming appointments and current in-progress appointments.

### Reports
- Appointment counts by day/week/month.
- Revenue by day/week/month.
- Revenue and completed service count by service.
- Revenue and appointment count by provider.
- Most frequently selected services.
- Cancellation and no-show rates.
- New vs returning customers.
- Peak hours.
- Bed utilization: occupied bed-minutes / available bed-minutes.
- Provider utilization: booked occupied minutes / scheduled working minutes.

Revenue definition for MVP: sum of appointment service price snapshots for `COMPLETED` appointments only. If payment/discount/refund tracking is later introduced, report recognized revenue from payment records rather than appointment price alone.

All reports accept date range and use `Asia/Ho_Chi_Minh` for business-day grouping.

## 12. Security and quality
- No public signup; OWNER creates STAFF.
- Hash passwords with bcrypt/Argon2.
- Short-lived access tokens; revocable refresh tokens.
- Rate-limit login; restrict CORS to frontend origin.
- Zod validation; authorization in middleware and service layer.
- Never return password hashes or secrets.
- Central error format: `{ success, data, message, code, meta }`.
- Pagination and request IDs.
- Unit tests for overlap, duration calculation, capacity policy and permissions.
- Integration tests for transactions and concurrent booking attempts.
- `GET /health` endpoint.

## 13. Deployment
- Frontend: Render Static Site.
- Backend: Render Free Web Service; cold starts are accepted for the free MVP.
- Database: MongoDB Atlas M0.
- Environment variables: `MONGODB_URI`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CLIENT_ORIGIN`, `TZ`.
- Back up MongoDB data regularly; do not commit `.env`.
