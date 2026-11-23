import { useState } from 'react'
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { useAuthStore } from './store'
import './App.css'

const navItems = [
  ['/', 'Tổng quan'],
  ['/calendar', 'Lịch hẹn'],
  ['/customers', 'Khách hàng'],
  ['/services', 'Dịch vụ'],
  ['/staff', 'Nhân viên'],
  ['/beds', 'Giường'],
  ['/reports', 'Báo cáo'],
  ['/settings', 'Cài đặt'],
]

function Login() {
  const navigate = useNavigate()
  const setUser = useAuthStore((state) => state.setUser)
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setError('')
    try {
      const { data } = await api.post('/auth/login', form)
      localStorage.setItem('spa_access_token', data.data.accessToken)
      localStorage.setItem('spa_refresh_token', data.data.refreshToken)
      setUser(data.data.user)
      navigate('/')
    } catch (loginError) {
      setError(loginError.response?.data?.message || 'Không thể đăng nhập.')
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-mark">LEMN</div>
        <p className="brand-tagline">SKIN &amp; SPA</p>
        <h1>Chào mừng trở lại</h1>
        <label>Email<input type="email" required value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
        <label>Mật khẩu<input type="password" required minLength={6} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
        {error && <p className="error-text">{error}</p>}
        <button type="submit">Đăng nhập</button>
      </form>
    </main>
  )
}

function Shell() {
  const user = useAuthStore((state) => state.user)
  const logout = useAuthStore((state) => state.logout)
  if (!user) return <Navigate to="/login" replace />
  const visibleNavItems = navItems.filter(([, label]) => {
    if (user.role === 'OWNER') return true
    return !['Nhân viên', 'Giường', 'Cài đặt'].includes(label)
  })

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand brand-mark">LEMN</div>
        <div className="brand-subtitle">SKIN &amp; SPA</div>
        <nav>{visibleNavItems.map(([path, label]) => (
          <NavLink key={path} to={path} end={path === '/'}>{label}</NavLink>
        ))}</nav>
        <button className="logout" onClick={() => { logout(); window.location.href = '/login' }}>Đăng xuất</button>
      </aside>
      <main className="content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/services" element={<Services />} />
          <Route path="/staff" element={<Staff />} />
          <Route path="/beds" element={<Beds />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  )
}

function PageTitle({ title, action }) {
  return <header className="page-title"><h1>{title}</h1>{action}</header>
}

function Dashboard() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get('/dashboard/summary')).data.data,
  })
  if (isLoading) return <div className="loading">Đang tải...</div>
  if (error) return <ErrorState retry={refetch} />
  return (
    <>
      <PageTitle title="Dashboard" />
      <section className="kpi-grid">
        <Kpi label="Lịch hẹn hôm nay" value={data.appointmentsToday} />
        <Kpi label="Sắp tới" value={data.upcoming} />
        <Kpi label="Đang phục vụ" value={data.inProgress?.length ?? 0} />
        <Kpi label="Khách đồng thời" value={`${data.currentConcurrentCustomers}/${data.configuredCapacity}`} />
        {data.revenueToday !== null && <Kpi label="Doanh thu hôm nay" value={`${data.revenueToday.toLocaleString('vi-VN')} ₫`} />}
        <Kpi label="Giường hoạt động" value={data.beds} />
      </section>
      <section className="panel">
        <h2>Lịch hẹn đang thực hiện</h2>
        {data.inProgress?.length ? data.inProgress.map((appointment) => (
          <div className="row" key={appointment._id}>
            <span>{appointment.customerId?.fullName || 'Khách hàng'}</span>
            <span>{appointment.staffId?.displayName || 'Nhân viên'}</span>
          </div>
        )) : <EmptyState text="Không có khách đang phục vụ." />}
      </section>
    </>
  )
}

function Kpi({ label, value }) {
  return <article className="kpi"><span>{label}</span><strong>{value}</strong></article>
}

function Calendar() {
  const [showForm, setShowForm] = useState(false)
  const [editingAppointment, setEditingAppointment] = useState(null)
  const [conflict, setConflict] = useState('')
  const [viewDate, setViewDate] = useState(() => new Date())
  const [statusFilter, setStatusFilter] = useState('ALL')
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['appointments', viewDate.toISOString().slice(0, 10)],
    queryFn: async () => {
      const start = new Date(viewDate)
      start.setHours(0, 0, 0, 0)
      const end = new Date(start)
      end.setDate(end.getDate() + 1)
      return (await api.get('/appointments', {
        params: { from: start.toISOString(), to: end.toISOString(), limit: 200 },
      })).data.data
    },
  })
  const appointments = (data || []).filter((item) => statusFilter === 'ALL' || item.status === statusFilter)
  const hours = Array.from({ length: 11 }, (_, index) => index + 8)
  const moveDay = (amount) => {
    setViewDate((current) => {
      const next = new Date(current)
      next.setDate(next.getDate() + amount)
      return next
    })
  }
  const formatDay = viewDate.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })

  async function cancelAppointment(appointment) {
    const reason = window.prompt('Lý do hủy lịch hẹn:', 'Khách có việc phát sinh')
    if (!reason) return
    try {
      await api.patch(`/appointments/${appointment._id}/status`, { status: 'CANCELLED', reason })
      refetch()
    } catch (error) {
      setConflict(error.response?.data?.message || 'Không thể hủy lịch hẹn.')
    }
  }

  async function updateAppointmentStatus(appointment, status) {
    try {
      await api.patch(`/appointments/${appointment._id}/status`, { status })
      refetch()
    } catch (error) {
      setConflict(error.response?.data?.message || 'Không thể cập nhật trạng thái lịch hẹn.')
    }
  }

  function getStatusLabel(status) {
    return {
      CONFIRMED: 'Đã xác nhận',
      ARRIVED: 'Khách đã đến',
      IN_PROGRESS: 'Đang thực hiện',
      COMPLETED: 'Hoàn thành',
      CANCELLED: 'Đã hủy',
      NO_SHOW: 'Khách không đến',
    }[status] || status
  }

  return (
    <>
      <PageTitle title="Lịch hẹn" action={<button onClick={() => setShowForm(true)}>+ Tạo lịch hẹn</button>} />
      <div className="timeline-toolbar">
        <div className="date-controls">
          <button type="button" className="icon-button" onClick={() => moveDay(-1)} aria-label="Ngày trước">‹</button>
          <button type="button" className="today-button" onClick={() => setViewDate(new Date())}>Hôm nay</button>
          <strong>{formatDay}</strong>
          <button type="button" className="icon-button" onClick={() => moveDay(1)} aria-label="Ngày sau">›</button>
        </div>
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Lọc trạng thái">
          <option value="ALL">Tất cả trạng thái</option>
          <option value="CONFIRMED">Đã xác nhận</option>
          <option value="ARRIVED">Khách đã đến</option>
          <option value="IN_PROGRESS">Đang thực hiện</option>
          <option value="COMPLETED">Hoàn thành</option>
          <option value="CANCELLED">Đã hủy</option>
          <option value="NO_SHOW">Khách không đến</option>
        </select>
      </div>
      {conflict && <div className="alert">{conflict}</div>}
      {showForm && <AppointmentForm onClose={() => setShowForm(false)} onConflict={(message) => setConflict(message)} onSuccess={() => { setShowForm(false); refetch() }} />}
      {isLoading ? <div className="loading">Đang tải lịch...</div> : error ? <ErrorState retry={refetch} /> : (
        <section className="timeline" aria-label="Timeline lịch hẹn theo giờ">
          <div className="timeline-axis">
            {hours.map((hour) => <div className="timeline-hour" key={hour}><span>{String(hour).padStart(2, '0')}:00</span></div>)}
          </div>
          <div className="timeline-events">
            {appointments.map((appointment) => {
              const start = new Date(appointment.startAt)
              const durationMinutes = Number(appointment.estimatedDurationMinutes)
                || Math.max(
                  30,
                  (new Date(appointment.estimatedEndAt || appointment.occupiedEndAt) - start) / 60_000,
                )
              const end = new Date(start.getTime() + durationMinutes * 60_000)
              const startMinute = start.getHours() * 60 + start.getMinutes()
              const duration = Math.max(30, (end - start) / 60_000)
              const top = ((startMinute - 8 * 60) / 60) * 72
              const height = Math.max(48, (duration / 60) * 72)
              return (
                <article
                  className={`timeline-event status-${appointment.status.toLowerCase()}`}
                  style={{ top: `${top}px`, height: `${height}px` }}
                  key={appointment._id}
                >
                  <div className="event-time">
                    {start.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                    {' - '}
                    {end.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className="event-content">
                    <strong>{appointment.customerId?.fullName || 'Khách hàng'}</strong>
                    <span>{appointment.services?.map((service) => service.serviceNameSnapshot).join(', ')}</span>
                    <small>{appointment.staffId?.displayName || 'Nhân viên'} · {appointment.bedId?.name || 'Giường'}</small>
                  </div>
                  <div className="event-status-actions">
                    <span className={`event-status status-${appointment.status.toLowerCase()}`}>{getStatusLabel(appointment.status)}</span>
                    <div className="event-actions">
                      <button type="button" className="edit-event" onClick={() => setEditingAppointment(appointment)}>Sửa</button>
                      {appointment.status === 'CONFIRMED' && (
                        <>
                          <button type="button" className="arrived-event" onClick={() => updateAppointmentStatus(appointment, 'ARRIVED')}>Khách đã đến</button>
                          <button type="button" className="cancel-event" onClick={() => updateAppointmentStatus(appointment, 'NO_SHOW')}>Khách không đến</button>
                        </>
                      )}
                      {appointment.status === 'ARRIVED' && (
                        <button type="button" className="progress-event" onClick={() => updateAppointmentStatus(appointment, 'IN_PROGRESS')}>Bắt đầu</button>
                      )}
                      {appointment.status === 'IN_PROGRESS' && (
                        <button type="button" className="complete-event" onClick={() => updateAppointmentStatus(appointment, 'COMPLETED')}>Hoàn thành</button>
                      )}
                      {!['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(appointment.status) && (
                        <button type="button" className="cancel-event" onClick={() => cancelAppointment(appointment)}>Hủy</button>
                      )}
                    </div>
                  </div>
                </article>
              )
            })}
            {!appointments.length && <div className="timeline-empty"><EmptyState text="Chưa có lịch hẹn trong ngày này." /></div>}
          </div>
        </section>
      )}
      {editingAppointment && (
        <EditAppointmentForm
          appointment={editingAppointment}
          onClose={() => setEditingAppointment(null)}
          onConflict={(message) => setConflict(message)}
          onSuccess={() => {
            setEditingAppointment(null)
            refetch()
          }}
        />
      )}
    </>
  )
}

function AppointmentForm({ onClose, onSuccess, onConflict }) {
  const [form, setForm] = useState({
    customerName: '',
    customerPhone: '',
    startAt: '',
    serviceIds: [],
    estimatedDurationMinutes: '',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const { data: services = [] } = useQuery({
    queryKey: ['active-services'],
    queryFn: async () => (await api.get('/services')).data.data,
  })

  const selectedServices = services.filter((service) => form.serviceIds.includes(service._id))
  const summedDuration = selectedServices.reduce((sum, service) => sum + Number(service.defaultDurationMinutes), 0)
  const summedPrice = selectedServices.reduce((sum, service) => sum + Number(service.defaultPrice), 0)
  const estimatedDuration = form.estimatedDurationMinutes
    ? Number(form.estimatedDurationMinutes)
    : summedDuration
  const estimatedEndAt = form.startAt && estimatedDuration
    ? new Date(new Date(form.startAt).getTime() + estimatedDuration * 60_000)
    : null

  async function submit(event) {
    event.preventDefault()
    if (!selectedServices.length) {
      onConflict('Vui lòng chọn ít nhất một dịch vụ.')
      return
    }
    setSaving(true)
    try {
      await api.post('/appointments', {
        customerName: form.customerName,
        customerPhone: form.customerPhone,
        startAt: new Date(form.startAt).toISOString(),
        serviceIds: form.serviceIds,
        estimatedDurationMinutes: estimatedDuration,
        durationMode: 'MANUAL',
        notes: form.notes,
      })
      onSuccess()
    } catch (error) {
      onConflict(error.response?.data?.message || 'Khung giờ không còn khả dụng.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="appointment-form panel" onSubmit={submit}>
      <div className="appointment-form-heading">
        <div>
          <p className="eyebrow">Tạo lịch mới</p>
          <h2>Thông tin lịch hẹn</h2>
        </div>
        {estimatedEndAt && (
          <div className="end-time-preview">
            <span>Kết thúc dự kiến</span>
            <strong>{estimatedEndAt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</strong>
          </div>
        )}
      </div>
      <label>Tên khách hàng<input required placeholder="Nhập họ và tên" value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} /></label>
      <label>Số điện thoại<input required type="tel" placeholder="Nhập số liên hệ" value={form.customerPhone} onChange={(event) => setForm({ ...form, customerPhone: event.target.value })} /></label>
      <label>Thời gian bắt đầu<input type="datetime-local" required value={form.startAt} onChange={(event) => setForm({ ...form, startAt: event.target.value })} /></label>
      <fieldset className="service-picker">
        <legend>Dịch vụ sử dụng</legend>
        <div className="service-options">
          {services.filter((service) => service.isActive).map((service) => (
            <label className={`service-option ${form.serviceIds.includes(service._id) ? 'selected' : ''}`} key={service._id}>
              <input
                type="checkbox"
                checked={form.serviceIds.includes(service._id)}
                onChange={(event) => {
                  const nextIds = event.target.checked
                    ? [...form.serviceIds, service._id]
                    : form.serviceIds.filter((serviceId) => serviceId !== service._id)
                  setForm({ ...form, serviceIds: nextIds, estimatedDurationMinutes: '' })
                }}
              />
              <span>
                <strong>{service.name}</strong>
                <small>{Number(service.defaultPrice).toLocaleString('vi-VN')}đ · {service.defaultDurationMinutes} phút</small>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {selectedServices.length > 0 && (
        <div className="multi-service-summary">
          <span>Đã chọn {selectedServices.length} dịch vụ</span>
          <strong>{summedPrice.toLocaleString('vi-VN')}đ · {summedDuration} phút</strong>
        </div>
      )}
      <label>Thời lượng dự kiến (phút)<input type="number" min="1" required value={estimatedDuration} onChange={(event) => setForm({ ...form, estimatedDurationMinutes: event.target.value })} /></label>
      <label>Ghi chú<textarea placeholder="Yêu cầu hoặc tình trạng da..." value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
      <div className="form-actions"><button type="button" className="secondary" onClick={onClose}>Hủy</button><button disabled={saving} type="submit">{saving ? 'Đang lưu...' : 'Tạo lịch'}</button></div>
    </form>
  )
}

function EditAppointmentForm({ appointment, onClose, onSuccess, onConflict }) {
  const currentServiceIds = (appointment.services || []).map((service) => {
    const id = service.serviceId?._id || service.serviceId
    return String(id || '')
  }).filter(Boolean)
  const currentDuration = appointment.estimatedDurationMinutes
  function toDateTimeLocalValue(value) {
    const date = new Date(value)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hour = String(date.getHours()).padStart(2, '0')
    const minute = String(date.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day}T${hour}:${minute}`
  }

  const [form, setForm] = useState({
    customerName: appointment.customerId?.fullName || '',
    customerPhone: appointment.customerId?.phone || '',
    startAt: toDateTimeLocalValue(appointment.startAt),
    serviceIds: currentServiceIds,
    estimatedDurationMinutes: String(currentDuration),
    notes: appointment.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const { data: services = [] } = useQuery({
    queryKey: ['active-services'],
    queryFn: async () => (await api.get('/services')).data.data,
  })

  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    try {
      await api.patch(`/appointments/${appointment._id}`, {
        customerName: form.customerName,
        customerPhone: form.customerPhone,
        startAt: new Date(form.startAt).toISOString(),
        serviceIds: form.serviceIds,
        estimatedDurationMinutes: Number(form.estimatedDurationMinutes),
        notes: form.notes,
      })
      onSuccess()
    } catch (error) {
      onConflict(error.response?.data?.message || 'Không thể chỉnh sửa lịch hẹn.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="edit-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <form className="appointment-form panel edit-modal" onSubmit={submit}>
        <div className="appointment-form-heading">
          <div>
            <p className="eyebrow">Chỉnh sửa</p>
            <h2>Thông tin lịch hẹn</h2>
          </div>
        </div>
        <label>Tên khách hàng<input required value={form.customerName} onChange={(event) => setForm({ ...form, customerName: event.target.value })} /></label>
        <label>Số điện thoại<input required type="tel" value={form.customerPhone} onChange={(event) => setForm({ ...form, customerPhone: event.target.value })} /></label>
        <label>Thời gian bắt đầu<input type="datetime-local" required value={form.startAt} onChange={(event) => setForm({ ...form, startAt: event.target.value })} /></label>
        <fieldset className="service-picker">
          <legend>Dịch vụ sử dụng</legend>
          <div className="service-options">
            {services.filter((service) => service.isActive).map((service) => (
              <label className={`service-option ${form.serviceIds.includes(service._id) ? 'selected' : ''}`} key={service._id}>
                <input
                  type="checkbox"
                  checked={form.serviceIds.includes(service._id)}
                  onChange={(event) => {
                    const nextIds = event.target.checked
                      ? [...form.serviceIds, service._id]
                      : form.serviceIds.filter((serviceId) => serviceId !== service._id)
                    setForm({ ...form, serviceIds: nextIds, estimatedDurationMinutes: '' })
                  }}
                />
                <span>
                  <strong>{service.name}</strong>
                  <small>{Number(service.defaultPrice).toLocaleString('vi-VN')}đ · {service.defaultDurationMinutes} phút</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {selectedServices.length > 0 && (
          <div className="multi-service-summary">
            <span>Đã chọn {selectedServices.length} dịch vụ</span>
            <strong>{summedPrice.toLocaleString('vi-VN')}đ · {summedDuration} phút</strong>
          </div>
        )}
        <label>Thời lượng dự kiến (phút)<input required type="number" min="1" value={form.estimatedDurationMinutes} onChange={(event) => setForm({ ...form, estimatedDurationMinutes: event.target.value })} /></label>
        <label>Ghi chú<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onClose}>Đóng</button>
          <button type="submit" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu thay đổi'}</button>
        </div>
      </form>
    </div>
  )
}

function ResourceList({ endpoint, title, fields, showTitle = true }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: [endpoint], queryFn: async () => (await api.get(`/${endpoint}`)).data.data })
  return (
    <>
      {showTitle && <PageTitle title={title} />}
      {isLoading ? <div className="loading">Đang tải...</div> : error ? <ErrorState retry={refetch} /> : (
        <section className="panel table-list">
          {data?.length ? data.map((item) => (
            <div className="row" key={item._id}>{fields.map((field) => <span key={field}>{item[field] === true ? 'Đang hoạt động' : item[field] === false ? 'Ngưng hoạt động' : item[field] || '-'}</span>)}</div>
          )) : <EmptyState text="Chưa có dữ liệu." />}
        </section>
      )}
    </>
  )
}

function Customers() { return <ResourceList endpoint="customers" title="Customers" fields={['fullName', 'phone', 'email', 'notes']} /> }
function Services() {
  const user = useAuthStore((state) => state.user)
  const [showForm, setShowForm] = useState(false)
  const [editingService, setEditingService] = useState(null)
  const [form, setForm] = useState({ name: '', description: '', defaultPrice: '', defaultDurationMinutes: '' })
  const [message, setMessage] = useState('')
  const queryClient = useQueryClient()
  const { data: services = [], isLoading, error, refetch } = useQuery({
    queryKey: ['services'],
    queryFn: async () => (await api.get('/services')).data.data,
  })

  async function createService(event) {
    event.preventDefault()
    try {
      await api.post('/services', {
        name: form.name,
        description: form.description,
        defaultPrice: Number(form.defaultPrice),
        defaultDurationMinutes: Number(form.defaultDurationMinutes),
        isActive: true,
      })
      setForm({ name: '', description: '', defaultPrice: '', defaultDurationMinutes: '' })
      setShowForm(false)
      setMessage('Đã tạo dịch vụ mới.')
      queryClient.invalidateQueries({ queryKey: ['services'] })
      queryClient.invalidateQueries({ queryKey: ['active-services'] })
    } catch (error) {
      setMessage(error.response?.data?.message || 'Không thể tạo dịch vụ.')
    }
  }

  function openEdit(service) {
    setEditingService(service)
    setForm({
      name: service.name,
      description: service.description || '',
      defaultPrice: String(service.defaultPrice),
      defaultDurationMinutes: String(service.defaultDurationMinutes),
    })
  }

  async function updateService(event) {
    event.preventDefault()
    try {
      await api.patch(`/services/${editingService._id}`, {
        name: form.name,
        description: form.description,
        defaultPrice: Number(form.defaultPrice),
        defaultDurationMinutes: Number(form.defaultDurationMinutes),
      })
      setEditingService(null)
      setMessage('Đã cập nhật dịch vụ.')
      queryClient.invalidateQueries({ queryKey: ['services'] })
      queryClient.invalidateQueries({ queryKey: ['active-services'] })
      refetch()
    } catch (serviceError) {
      setMessage(serviceError.response?.data?.message || 'Không thể cập nhật dịch vụ.')
    }
  }

  async function deleteService(service) {
    if (!window.confirm(`Ngừng dịch vụ "${service.name}"? Dịch vụ sẽ không còn xuất hiện khi đặt lịch.`)) return
    try {
      await api.delete(`/services/${service._id}`)
      setMessage('Đã ngừng dịch vụ.')
      queryClient.invalidateQueries({ queryKey: ['services'] })
      queryClient.invalidateQueries({ queryKey: ['active-services'] })
      refetch()
    } catch (serviceError) {
      setMessage(serviceError.response?.data?.message || 'Không thể ngừng dịch vụ.')
    }
  }

  return (
    <>
      <PageTitle title="Dịch vụ" action={user?.role === 'OWNER' && <button onClick={() => setShowForm(true)}>+ Thêm dịch vụ</button>} />
      {message && <div className="alert">{message}</div>}
      {showForm && (
        <form className="management-form panel" onSubmit={createService}>
          <h2>Thêm dịch vụ mới</h2>
          <label>Tên dịch vụ<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>Mô tả<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          <label>Giá (VND)<input required type="number" min="0" value={form.defaultPrice} onChange={(event) => setForm({ ...form, defaultPrice: event.target.value })} /></label>
          <label>Thời lượng mặc định (phút)<input required type="number" min="1" value={form.defaultDurationMinutes} onChange={(event) => setForm({ ...form, defaultDurationMinutes: event.target.value })} /></label>
          <div className="form-actions">
            <button type="button" className="secondary" onClick={() => setShowForm(false)}>Hủy</button>
            <button type="submit">Lưu dịch vụ</button>
          </div>
        </form>
      )}
      {editingService && (
        <form className="management-form panel" onSubmit={updateService}>
          <h2>Chỉnh sửa dịch vụ</h2>
          <label>Tên dịch vụ<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>Mô tả<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          <label>Giá (VND)<input required type="number" min="0" value={form.defaultPrice} onChange={(event) => setForm({ ...form, defaultPrice: event.target.value })} /></label>
          <label>Thời lượng mặc định (phút)<input required type="number" min="1" value={form.defaultDurationMinutes} onChange={(event) => setForm({ ...form, defaultDurationMinutes: event.target.value })} /></label>
          <div className="form-actions">
            <button type="button" className="secondary" onClick={() => setEditingService(null)}>Hủy</button>
            <button type="submit">Lưu thay đổi</button>
          </div>
        </form>
      )}
      <section className="menu-reference">
        <img src="/lemn-spa-menu.png" alt="Thực đơn chăm sóc da LEMN" />
      </section>
      {isLoading ? <div className="loading">Đang tải dịch vụ...</div> : error ? <ErrorState retry={refetch} /> : (
        <section className="service-grid">
          {services.map((service) => (
            <article className={`service-card ${service.isActive ? '' : 'inactive'}`} key={service._id}>
              <div className="service-card-top">
                <span className="service-index">LEMN</span>
                <span className={`badge ${service.isActive ? 'confirmed' : 'cancelled'}`}>{service.isActive ? 'Đang hoạt động' : 'Ngừng hoạt động'}</span>
              </div>
              <h2>{service.name}</h2>
              <p>{service.description || 'Chưa có mô tả dịch vụ.'}</p>
              <div className="service-meta">
                <strong>{Number(service.defaultPrice).toLocaleString('vi-VN')}đ</strong>
                <span>{service.defaultDurationMinutes} phút</span>
              </div>
              {user?.role === 'OWNER' && (
                <div className="service-actions">
                  <button type="button" className="secondary" onClick={() => openEdit(service)}>Chỉnh sửa</button>
                  {service.isActive && <button type="button" className="danger-button" onClick={() => deleteService(service)}>Ngừng dịch vụ</button>}
                </div>
              )}
            </article>
          ))}
        </section>
      )}
    </>
  )
}
function Staff() {
  const user = useAuthStore((state) => state.user)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ fullName: '', email: '', password: '', phone: '' })
  const [message, setMessage] = useState('')
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['staff'],
    queryFn: async () => (await api.get('/staff')).data.data,
  })

  async function createStaff(event) {
    event.preventDefault()
    try {
      await api.post('/staff', form)
      setForm({ fullName: '', email: '', password: '', phone: '' })
      setShowForm(false)
      setMessage('Đã tạo tài khoản nhân viên.')
      refetch()
    } catch (staffError) {
      setMessage(staffError.response?.data?.message || 'Không thể tạo nhân viên.')
    }
  }

  return (
    <>
      <PageTitle title="Nhân viên" action={user?.role === 'OWNER' && <button onClick={() => setShowForm(true)}>+ Thêm nhân viên</button>} />
      {message && <div className="alert">{message}</div>}
      {showForm && (
        <form className="management-form panel" onSubmit={createStaff}>
          <h2>Tạo tài khoản nhân viên</h2>
          <label>Họ và tên<input required value={form.fullName} onChange={(event) => setForm({ ...form, fullName: event.target.value })} /></label>
          <label>Email đăng nhập<input required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
          <label>Mật khẩu tạm thời<input required type="password" minLength={6} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></label>
          <label>Số điện thoại<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
          <div className="form-actions">
            <button type="button" className="secondary" onClick={() => setShowForm(false)}>Hủy</button>
            <button type="submit">Tạo tài khoản</button>
          </div>
        </form>
      )}
      {isLoading ? <div className="loading">Đang tải...</div> : error ? <ErrorState retry={refetch} /> : (
        <section className="staff-grid">
          {data?.length ? data.map((staff) => (
            <article className="staff-card" key={staff._id}>
              <div className="staff-avatar">{staff.displayName?.charAt(0)?.toUpperCase()}</div>
              <div>
                <strong>{staff.displayName}</strong>
                <span>{staff.userId?.email || '-'}</span>
                <small>{staff.phone || 'Chưa có số điện thoại'}</small>
              </div>
              <span className={`badge ${staff.isActive ? 'confirmed' : 'cancelled'}`}>{staff.isActive ? 'Đang làm việc' : 'Ngưng hoạt động'}</span>
            </article>
          )) : <EmptyState text="Chưa có nhân viên." />}
        </section>
      )}
    </>
  )
}
function Beds() { return <ResourceList endpoint="beds" title="Beds & capacity" fields={['name', 'code', 'isActive']} /> }

function Reports() {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['report-revenue'], queryFn: async () => (await api.get('/reports/revenue')).data.data })
  const serviceReport = useQuery({ queryKey: ['report-services'], queryFn: async () => (await api.get('/reports/services')).data.data })
  if (isLoading) return <div className="loading">Đang tải báo cáo...</div>
  if (error) return <ErrorState retry={refetch} />
  return (
    <>
      <PageTitle title="Reports" />
      <section className="kpi-grid">
        <Kpi label="Doanh thu" value={`${data.revenue.toLocaleString('vi-VN')} ₫`} />
        <Kpi label="Lịch hẹn hoàn tất" value={data.completedAppointments} />
      </section>
      <section className="panel">
        <h2>Dịch vụ phổ biến</h2>
        {serviceReport.data?.length ? serviceReport.data.map((item) => <div className="row" key={item.serviceName}><span>{item.serviceName}</span><strong>{item.count} lần · {item.revenue.toLocaleString('vi-VN')} ₫</strong></div>) : <EmptyState text="Chưa có dữ liệu dịch vụ." />}
      </section>
    </>
  )
}

function Settings() {
  const user = useAuthStore((state) => state.user)
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['settings'], queryFn: async () => (await api.get('/settings/concurrency')).data.data })
  const [capacity, setCapacity] = useState(1)
  if (isLoading) return <div className="loading">Đang tải cấu hình...</div>
  if (error) return <ErrorState retry={refetch} />
  return (
    <>
      <PageTitle title="Settings" />
      <section className="panel settings-panel">
        <h2>Cấu hình đồng thời</h2>
        <p>Giới hạn mặc định: <strong>{data.defaultMaxConcurrentCustomers} khách</strong></p>
        {user?.role === 'OWNER' ? (
          <div className="capacity-controls">
            <select value={capacity} onChange={(event) => setCapacity(Number(event.target.value))}><option value={1}>1 khách đồng thời</option><option value={2}>Tối đa 2 khách đồng thời</option></select>
            <button onClick={async () => { await api.put('/settings/concurrency', { defaultMaxConcurrentCustomers: capacity }); refetch() }}>Lưu cấu hình</button>
          </div>
        ) : <p>Chỉ chủ spa được thay đổi cấu hình.</p>}
        <small>Giới hạn tối đa tuyệt đối: {data.absoluteMaxConcurrentCustomers}. Thay đổi không tự động huỷ lịch hẹn hiện có.</small>
      </section>
    </>
  )
}

function ErrorState({ retry }) {
  return <div className="error-state"><p>Không thể tải dữ liệu.</p><button onClick={retry}>Thử lại</button></div>
}

function EmptyState({ text }) {
  return <p className="empty-state">{text}</p>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/*" element={<Shell />} />
    </Routes>
  )
}
