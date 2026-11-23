# Frontend Specification — Spa Management System

**Version:** 2.0  
**Application:** Internal web application for one small spa.

## 1. Business context
- One spa branch.
- Normally one employee performs services.
- The OWNER may also work as a second service provider.
- Two treatment beds.
- Default concurrency is one customer.
- OWNER may enable two simultaneous customers when the owner is working and there are two available providers and beds.
- A booking can contain multiple services.
- Staff can adjust the estimated duration for the appointment and add services after the customer arrives.

## 2. Technology
- React + TypeScript + Vite
- Tailwind CSS + shadcn/ui
- React Router
- TanStack Query
- Zustand only for suitable shared client state
- Axios
- React Hook Form + Zod
- FullCalendar Community

## 3. Navigation
- Dashboard
- Calendar / Appointments
- Customers
- Services
- Service providers
- Beds (OWNER settings; simple setup)
- Working schedules
- Reports
- Settings

## 4. Dashboard
Show:
- Today's total appointments.
- Upcoming and in-progress appointments.
- Completed, cancelled and no-show counts.
- Today's revenue (OWNER only).
- Current concurrent customer count and configured capacity.
- Bed utilization and provider utilization.
- Popular services and peak time chart.

## 5. Calendar — primary screen
### Views
- Day / Week / Month.
- Separate resource lanes for service providers.
- Optional bed label on each appointment.
- Filters by provider, bed, service and status.
- Today and previous/next navigation.

### Capacity display
- Clearly show default capacity 1/2.
- If OWNER enables capacity 2 for a period, show a visible indicator for that period.
- Do not imply that two bookings are allowed merely because two beds exist.
- When the second appointment is not operationally feasible, show why: no second provider, no free bed, provider conflict or capacity limit.

### Appointment interactions
- Click an empty time to create an appointment with date/time/provider prefilled.
- Click an appointment to open details.
- Drag/drop reschedule may be enabled, but must call the backend and handle HTTP 409.
- Calendar is a view of server data; never treat client-side availability as final.

## 6. Create appointment form
Fields:
1. Customer: search by name/phone or create customer quickly.
2. Service provider: choose OWNER or STAFF profile when available.
3. Bed: choose one of the active beds; backend may recommend an available bed.
4. Start date/time.
5. Services: add one or more services.
6. Per-service estimated duration: initially filled from service default and editable.
7. Total estimated duration: automatically sums service durations; staff may switch to manual total override.
8. Buffer time: optional setup/cleanup time.
9. Notes.

Live preview:
- Service list and subtotal.
- Total estimated treatment duration.
- Estimated end time.
- Occupied-until time including buffer.
- Provider/bed availability and concurrency capacity.

On submit:
- Send appointment data to backend.
- Backend recalculates authoritative prices/default values and validates resources.
- On 409, retain form data, explain the conflict and prompt staff to select another provider, bed or time.

## 7. Add services after customer arrival
Appointment detail must have an **Add service** action while the appointment is CONFIRMED or IN_PROGRESS, subject to permissions.

Flow:
1. Staff selects an additional service.
2. Default duration and price are loaded from the service catalogue.
3. Staff can adjust this service's estimated duration.
4. In AUTO mode, total duration and expected end time are recalculated.
5. In MANUAL mode, show the newly summed estimate and ask whether to keep the manual total or recalculate.
6. Backend checks whether the extension conflicts with the provider's next appointment, bed's next appointment or capacity.
7. If conflict exists, do not silently extend the appointment. Show the conflict and offer safe alternatives: change provider/bed if possible, choose a shorter estimate, or record the service as not scheduled in this appointment.
8. Save an appointment history entry.

Do not move another customer's appointment automatically.

## 8. Appointment detail
Display:
- Customer information.
- Provider and bed.
- Start time, estimated end time and occupied-until time.
- Service line items, each with price and duration snapshot.
- Duration mode AUTO/MANUAL.
- Notes and status.
- Created by / updated by.
- Change history.

Actions according to role and status:
- Add service.
- Edit estimated duration.
- Reschedule.
- Change provider or bed.
- Mark in progress.
- Complete.
- Cancel.
- Mark no-show.

## 9. Customers
- Search and pagination.
- Create/edit/view customer.
- Phone, email, notes.
- Visit history and service history.
- Visit count and returning-customer indicator.
- Total spend visible to OWNER if policy permits.

## 10. Services
- Name and description.
- Default price.
- Default estimated duration.
- Active/inactive.
- Optional provider eligibility mapping.
- Existing appointments retain their historical snapshots after catalogue edits.

## 11. Service providers and schedules
- OWNER account can optionally be enabled as a service provider.
- Staff profiles can be activated/deactivated independently from login role.
- Working shifts support multiple shifts per day.
- Time-off blocks provider availability.
- A provider is counted toward capacity only when active and scheduled to work.

## 12. Beds and capacity settings
### Bed management
- Seed two beds (Bed 1, Bed 2).
- Allow OWNER to rename/deactivate a bed.
- A bed cannot be deactivated if it has future active appointments without warning and resolution.

### Concurrency settings
- Default max concurrent customers: 1.
- Absolute max: 2.
- OWNER can enable max 2 for a selected day/time when a second provider is available.
- Display a warning if enabling capacity 2 is impossible due to provider or bed availability.
- If OWNER lowers capacity while two appointments overlap, warn and block new bookings that would worsen the over-capacity period. Do not auto-cancel existing bookings.

## 13. Reports
Filters:
- Date range.
- Provider.
- Service.
- Status.
- Day/week/month grouping.

Metrics:
- Appointment counts.
- Revenue by day/week/month.
- Revenue by service and provider.
- Popular services.
- Cancellation and no-show rates.
- New vs returning customers.
- Peak hours.
- Bed utilization.
- Provider utilization.
- Average estimated vs actual duration if actual duration tracking is introduced.

Revenue default: completed appointments only, based on saved price snapshots. Label the definition clearly.

## 14. Permissions
### OWNER
Full access, including concurrency settings, accounts, provider profiles, bed configuration and all reports. May also be assigned to appointments as a provider.

### STAFF
Can view full calendar, create appointments/customers, select available providers/beds, add services and update appointments according to policy. Cannot access owner-only settings or total revenue reports.

Frontend hiding is not security. Backend must enforce every permission.

## 15. API integration and UI states
- Axios base URL: `VITE_API_BASE_URL`.
- Handle 401 with one refresh attempt, then logout.
- Handle 403 as permission denied.
- Handle 409 as appointment resource/capacity conflict; refetch calendar.
- Invalidate calendar, appointment, dashboard and report queries after changes.
- Loading skeletons, empty states, retry errors, success/error toasts.
- Confirm before cancellation.
- Keep form values after conflict.
- Display all times in `Asia/Ho_Chi_Minh`.

## 16. Acceptance criteria
1. Default concurrency is one customer.
2. OWNER can enable two simultaneous customers for a defined period.
3. Two concurrent appointments require two available providers and two available beds.
4. No provider or bed can be double-booked.
5. A single appointment supports multiple services.
6. Default duration is the sum of service durations.
7. Staff can adjust the appointment-specific duration without changing the service catalogue.
8. Staff can add services after arrival and see the recalculated end time.
9. An extension that conflicts with the next booking is rejected or requires a safe resolution; no other appointment is silently moved.
10. Simultaneous API requests cannot exceed provider, bed or capacity constraints.
11. Dashboard and reports use saved appointment snapshots and correct business timezone.
