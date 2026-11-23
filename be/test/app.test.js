import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'

describe('Spa Manager API', () => {
  it('returns health status', async () => {
    const response = await request(createApp()).get('/health')
    expect(response.status).toBe(200)
    expect(response.body.success).toBe(true)
  })

  it('returns API health status', async () => {
    const response = await request(createApp()).get('/api/health')
    expect(response.status).toBe(200)
    expect(response.body.status).toBe('ok')
  })
})
