# Deploy

Your own copy of DOCKET runs on Vercel. It also uses three storage
services, which you add from inside Vercel: Upstash Redis, Vercel Blob and
Neon. One printer stays inside their free plans: Vercel Hobby, the Upstash
free plan and Neon Free ([store-costs.md](store-costs.md)).
[configuration.md](configuration.md) lists the settings and what each
storage service holds.

## A first deploy

### Create the project

1. Fork this repository on GitHub.
2. In Vercel, import the fork as a new project.
3. In the project's settings, set Node.js Version to 22.x. `package.json`
   names no Node version, so this setting decides it.

### Add the storage

Warning: do not connect the stores or add these variables to the Preview
environment. A preview deployment runs the code of any branch or pull
request. If Preview can use your production stores, that code can read and
change your production data.

1. In the project's Storage tab, add Upstash Redis.
2. Add a Vercel Blob store with public access. A private store does not
   work. DOCKET saves every file as public, and links to it by its public
   address.
3. Add a Neon database.
4. Connect each of the three to the Production environment only.
5. In Settings, Environment Variables, make sure that Production has the
   variables the storage services set:

   | Variable | From |
   |---|---|
   | `DATABASE_URL` | Neon: the connection string |
   | `BLOB_READ_WRITE_TOKEN` | Vercel Blob |
   | `KV_REST_API_URL` and `KV_REST_API_TOKEN` | Upstash. `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from the Upstash console also work |

### Add your settings

1. Add these variables to Production:

   | Variable | Value |
   |---|---|
   | `STORE_DRIVER` | `redis` |
   | `BETTER_AUTH_SECRET` | The output of `openssl rand -base64 32` |
   | `BETTER_AUTH_URL` | Your website's address, for example `https://your-app.vercel.app` |
   | `GEMINI_API_KEY` | Only if you use the Text messages slip: a Google AI Studio key |

2. Redeploy the project, so that it uses the new variables.

### Create the database tables and your account

Do these steps on your computer.

1. Clone your fork.
2. In its folder, install the dependencies: `npm install`
3. Copy the Neon connection string from the project's `DATABASE_URL`
   variable.
4. Create the database tables:

   ```
   DATABASE_URL="<neon connection string>" npm run db:migrate
   ```

5. Create your admin account. The script asks for a password.

   ```
   DATABASE_URL="<neon connection string>" node scripts/create-user.js "Your Name" you@example.com
   ```

6. Sign in on your website with that email and password.

### Connect the printer

1. In `firmware/docket-agent/`, copy `secrets.h.example` to `secrets.h`.
2. In `secrets.h`, set your Wi-Fi name and password. The board needs a
   2.4 GHz network.
3. Set `SECRET_SERVER_URL` to your website's address, with no slash at the
   end.
4. Leave `SECRET_DEVICE_TOKEN` empty, so that the printer pairs with your
   account.
5. Install the firmware on the board (flash it), as Stage 4 of
   [receipt-printer-build-guide.md](receipt-printer-build-guide.md)
   describes.
6. When the printer prints a pairing code, enter the code on the Printer
   page.

## After the first deploy

A push to `main` deploys. If the new code reads new database columns, run
the migration before you push:

```
DATABASE_URL="<neon connection string>" npm run db:migrate
```

DOCKET reads whole rows, so code that is ahead of the database fails every
query on the changed table.

Each slip preview's image link includes the deploy's short commit id, from
`VERCEL_GIT_COMMIT_SHA`, which Vercel sets. So a deploy that changes how
receipts render also refreshes the previews.
