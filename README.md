# Spa Manager

Full-stack project with an Express/MongoDB backend and React frontend.

## Backend

```bash
cd be
cp .env.example .env
npm install
npm run dev
```

Set `MONGODB_URI` in `be/.env` to a MongoDB Atlas connection string.
The API runs at `http://localhost:5000`; health check: `GET /api/health`.

### MongoDB Atlas authentication troubleshooting

If startup logs `bad auth : authentication failed`:

1. In Atlas, open **Database & Access** and reset or create a database user.
2. Copy the exact username and password into `MONGODB_URI`.
3. URL-encode special characters in the password (for example `@` becomes `%40`, `#` becomes `%23`).
4. In **Network Access**, add `0.0.0.0/0` for development or your current public IP.
5. Restart the backend with `npm run dev`.

## Frontend

```bash
cd fe
cp .env.example .env
npm install
npm run dev
```

The frontend runs at `http://localhost:5173` and proxies `/api` to the backend.

## Render deployment

1. Add the MongoDB Atlas connection string and allowed frontend origin as Render environment variables.
2. Allow network access from Render in Atlas (`0.0.0.0/0` or a reviewed IP strategy).
3. Deploy with `render.yaml` or create two services:
   - backend root: `be`, build `npm ci && npm run build`, start `npm start`
   - frontend root: `fe`, build `npm ci && npm run build`, publish `dist`
4. Set frontend `VITE_API_BASE_URL` to `https://<backend>.onrender.com/api/v1` before building.
5. Set backend `CLIENT_ORIGIN` to the exact frontend URL, for example `https://<frontend>.onrender.com`.