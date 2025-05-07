# Zepia SNKRS Backend

A simple backend for handling users, login limits, and Stripe subscriptions using Supabase.

## 🚀 Deployment (Render)
1. Push this repo to GitHub.
2. Go to [https://render.com](https://render.com), create an account.
3. Create new **Web Service** from your repo.
4. Set the environment variables:
   - SUPABASE_URL
   - SUPABASE_SERVICE_KEY
   - STRIPE_SECRET_KEY
   - STRIPE_WEBHOOK_SECRET
   - PORT (optional)
5. Set the build & start commands:
   - Build: `npm install`
   - Start: `npm start`

## 🧪 Local Testing (Optional)
Install the Stripe CLI to listen to webhooks:
```bash
stripe listen --forward-to localhost:3000/webhook
```

## 📬 Endpoints
- `POST /v1/auth/login`
- `POST /v1/auth/logout`
- `GET /v1/users/:accessKey`
- `GET /v1/app`
- `POST /webhook` (Stripe)
