# BLESS shop on Vercel (no card needed)

Same shop and admin, packaged to run on Vercel's free plan with a Neon database.
Settings you must add in Vercel (Project → Settings → Environment Variables):

- DATABASE_URL  = your Neon connection string
- ADMIN_PASSWORD = a long password (8+ characters)

Photos: Vercel accepts uploads up to about 4.5 MB, so product and customer photos are limited to 4 MB here.
Admin is at /admin/ on your address.
