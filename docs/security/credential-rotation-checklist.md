# Credential Rotation Checklist

Created from local `.env` variable names only. No secret values are stored here.

Assume every listed credential is compromised until it has been rotated in the owning system and the old value has been invalidated.

## Rotation Status

- [ ] `ACCOUNT_ADMIN_TOKEN`
- [ ] `ACCOUNT_EMAIL_REPLY_TO`
- [ ] `ACCOUNT_EMAIL_SENDER`
- [ ] `ACCOUNT_SESSION_SECRET`
- [ ] `AMAZON_SES_IAM_USERNAME`
- [ ] `CLOUDFLARE_API_TOKEN`
- [ ] `CLOUDFLARE_EMAIL`
- [ ] `CLOUDFLARE_GLOBAL_API_KEY`
- [ ] `CRISP_API_DEVELOPMENT_TOKEN_IDENTIFIER`
- [ ] `CRISP_API_DEVELOPMENT_TOKEN_KEY`
- [ ] `CRISP_API_DEVELOPMENT_TOKEN_SECRET`
- [ ] `CRISP_WEBSITE_ID`
- [ ] `DATABASE_URL`
- [ ] `DATABASE_URL_UNPOOLED`
- [ ] `DUB_API_KEY`
- [ ] `DUB_TEST_LINK`
- [ ] `GHL_AFFILIATE_FIELD_ID`
- [ ] `GHL_API_BASE_URL`
- [ ] `GHL_LOCATION_ID`
- [ ] `GHL_PAT_LOCATION`
- [ ] `GHL_PAYMENT_WEBHOOK_SECRET`
- [ ] `INTERNAL_ENTITLEMENTS_TOKEN`
- [ ] `LICENSE_ADMIN_URL`
- [ ] `LICENSE_KEY_ADMIN_API_KEY`
- [ ] `MONITORING_TOKEN`
- [ ] `NEXT_PUBLIC_DUB_PUBLISHABLE_KEY`
- [ ] `NEXT_PUBLIC_POSTHOG_HOST`
- [ ] `NEXT_PUBLIC_POSTHOG_KEY`
- [ ] `NEXT_PUBLIC_RUNTIME_ENV`
- [ ] `NEXT_PUBLIC_SITE_URL`
- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_LIVE`
- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_TEST`
- [ ] `NPM_TOKEN`
- [ ] `PAYPAL_CLIENT_ID__serpapps__live`
- [ ] `PAYPAL_CLIENT_ID__serpapps__test`
- [ ] `PAYPAL_CLIENT_SECRET__serpapps__live`
- [ ] `PAYPAL_CLIENT_SECRET__serpapps__test`
- [ ] `PAYPAL_WEBHOOK_ID__serpapps__live`
- [ ] `PAYPAL_WEBHOOK_ID__serpapps__test`
- [ ] `PGDATABASE`
- [ ] `PGHOST`
- [ ] `PGHOST_UNPOOLED`
- [ ] `PGPASSWORD`
- [ ] `PGUSER`
- [ ] `POSTGRES_DATABASE`
- [ ] `POSTGRES_HOST`
- [ ] `POSTGRES_PASSWORD`
- [ ] `POSTGRES_PRISMA_URL`
- [ ] `POSTGRES_URL`
- [ ] `POSTGRES_URL_NON_POOLING`
- [ ] `POSTGRES_URL_NO_SSL`
- [ ] `POSTGRES_USER`
- [ ] `POSTHOG_API_KEY`
- [ ] `SERP_AUTH_CF_ACCOUNT_ID`
- [ ] `SERP_AUTH_CF_API_TOKEN`
- [ ] `SERP_AUTH_CF_D1_DATABASE_ID`
- [ ] `SERP_AUTH_INTERNAL_SECRET`
- [ ] `SLACK_ALERT_WEBHOOK_URL`
- [ ] `SMTP_HOST`
- [ ] `SMTP_PASS`
- [ ] `SMTP_PORT`
- [ ] `SMTP_SECURE`
- [ ] `SMTP_USER`
- [ ] `STAGING_BASE_URL`
- [ ] `STRIPE_BILLING_PORTAL_CONFIGURATION_ID_LIVE`
- [ ] `STRIPE_BILLING_PORTAL_CONFIGURATION_ID_TEST`
- [ ] `STRIPE_CROSS_SELL_ADULT_BUNDLE_PRODUCT_ID_LIVE`
- [ ] `STRIPE_CROSS_SELL_ADULT_BUNDLE_PRODUCT_ID_TEST`
- [ ] `STRIPE_CROSS_SELL_ALL_BUNDLE_PRODUCT_ID_LIVE`
- [ ] `STRIPE_CROSS_SELL_ALL_BUNDLE_PRODUCT_ID_TEST`
- [ ] `STRIPE_CROSS_SELL_DOWNLOADERS_PRODUCT_ID_LIVE`
- [ ] `STRIPE_CROSS_SELL_DOWNLOADERS_PRODUCT_ID_TEST`
- [ ] `STRIPE_SECRET_KEY`
- [ ] `STRIPE_SECRET_KEY_TEST`
- [ ] `STRIPE_TEST_PRICE_ID`
- [ ] `STRIPE_WEBHOOK_SECRET`
- [ ] `STRIPE_WEBHOOK_SECRET_STAGING`
- [ ] `STRIPE_WEBHOOK_SECRET_TEST`
- [ ] `TEST_ACCOUNT_ADMIN_TOKEN`
- [ ] `TEST_GHL_SECRET`
- [ ] `TEST_GHL_URL`
- [ ] `VERCEL_PROJECT`
- [ ] `VERCEL_TEAM`
- [ ] `VERCEL_TOKEN`
- [ ] `YOUTUBE_API_KEY`

## Follow-Up

- Move live values out of the repo working tree before any future commit.
- Rotate production values before rewriting local history, because history cleanup does not invalidate copied credentials.
- After rotation, run `gitleaks detect --source . --log-opts="--all" --redact` to confirm no secret-like values remain reachable.
