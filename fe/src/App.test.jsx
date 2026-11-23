import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('LEMN SPA frontend', () => {
  it('renders the login page for unauthenticated users', () => {
    localStorage.clear()
    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByText('LEMN')).toBeTruthy()
  })
})
