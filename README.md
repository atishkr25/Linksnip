# Linksnip : url shortener

Node.js + Express + MongoDB + EJS based URL shortener with authentication, analytics dashboard, QR support, custom slugs, Redis caching, and rate limiting.

## Tech Stack

- Node.js
- Express
- MongoDB + Mongoose
- EJS
- JWT + cookie-parser
- bcryptjs
- nanoid
- geoip-lite
- ua-parser-js
- qrcode
- ioredis
- express-rate-limit
- dotenv

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` using `.env.example`:

```env
PORT=8002
JWT_SECRET=replace_with_secure_secret
BASE_URL=http://localhost:8002
REDIS_URL=redis://127.0.0.1:6379
```

3. Ensure MongoDB is running locally on:

`mongodb://127.0.0.1:27017/short-url`

4. Optional: Run Redis locally on:

`redis://127.0.0.1:6379`

The app works without Redis as well (cache falls back to MongoDB only).

## Run

```bash
npm run dev
```

Open `http://localhost:8002` in your browser.

## overview
<img width="1468" height="883" alt="Screenshot 2026-03-10 at 11 32 17 AM" src="https://github.com/user-attachments/assets/cbb6f92e-0d6b-4587-a916-37e7a6edabd1" />

## Routes

### Static/Auth Pages

- `GET /` - Home page (shows user URLs if logged in)
- `GET /signup` - Signup page
- `GET /login` - Login page
- `GET /logout` - Logout user (clears auth cookie)

## Architecture
<img width="821" height="535" alt="architecture" src="https://github.com/user-attachments/assets/5520caa1-3602-45f0-9705-80cf2bdd6a0c" />

### User Auth APIs

- `POST /user/signup` - Create a new user account
- `POST /user/login` - Authenticate user and set JWT cookie

### URL APIs

- `POST /url` - Create short URL (auth required, supports optional `customSlug`)
- `GET /url/analytics/:shortId` - Analytics for a short URL
  - Returns JSON when `Accept: application/json`
  - Renders analytics dashboard otherwise
- `GET /url/qr/:shortId` - QR code PNG for short URL

### Redirect

- `GET /:shortId` - Redirect short code to original URL and store enriched visit analytics

## Rate Limits

- General limiter: `100` requests per `15` minutes across app
- URL creation limiter: `10` requests per hour on `POST /url`
- Auth limiter: `5` attempts per `15` minutes on:
  - `POST /user/login`
  - `POST /user/signup`

## Notes

- Visit analytics include timestamp, IP, country, city, device, browser, OS, and referrer.
- Localhost/private-network visits are tagged as `Local` for country and city.
- Redirect lookup uses Redis cache when available, with MongoDB fallback on Redis failure.
