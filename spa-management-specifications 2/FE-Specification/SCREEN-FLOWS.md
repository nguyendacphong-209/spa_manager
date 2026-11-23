# Frontend User Flows

## 1. Create an appointment
1. Open Calendar.
2. Select a time or click Create appointment.
3. Find/create customer.
4. Select a service provider.
5. Select an available bed.
6. Add one or more services.
7. Each service loads its default duration; staff may adjust each estimate.
8. Total duration is summed automatically; staff may choose manual total override.
9. Select start time and review estimated end/occupied-until time.
10. Submit. On 409, retain form and explain which resource/capacity is unavailable.

## 2. Enable two-customer capacity
1. OWNER opens capacity settings or the selected calendar date.
2. Turns on "Allow up to 2 simultaneous customers" for the chosen period.
3. Backend checks that two active beds and two available service providers can cover the period.
4. UI displays the override and its time range.
5. If the prerequisites are not met, show the reason and do not enable the override.

## 3. Add a service after arrival
1. Open an existing appointment.
2. Click Add service.
3. Select service; default price/duration are loaded.
4. Adjust estimated duration if needed.
5. If duration mode is AUTO, recalculate total and expected end time.
6. If duration mode is MANUAL, ask whether to keep manual total or use the new sum.
7. Backend checks provider, bed and capacity for the extended interval.
8. If there is a conflict, do not save the extension or move another appointment automatically.
9. On success, update calendar and appointment history.

## 4. Reports
1. Open Reports.
2. Select date range and grouping.
3. Filter by provider/service/status.
4. Show KPI cards, charts and detail table.
5. OWNER sees revenue reports; STAFF sees only permitted operational reports.
