# Den Zero — Registration

Startup pitch event registration: multi-step branded form + Node/Express backend + Postgres + admin dashboard.

```
public/          the registration form (static)
views/admin.html admin dashboard (served behind auth at /admin)
server.js        Express API + static hosting
schema.sql       Postgres schema (one table)
uploads/         pitch decks & payment screenshots (created at runtime)
```

## Run locally

```bash
npm install
cp .env.example .env          # fill in DATABASE_URL + admin credentials
psql "$DATABASE_URL" -f schema.sql
npm start                     # → http://localhost:8642
```

- Form: `http://localhost:8642`
- Admin: `http://localhost:8642/admin` (password login — `ADMIN_PASS` from `.env`, 12h sessions)
- CSV export: `/api/admin/export.csv`

## Deploy on your server

```bash
# 1. Copy the project (without node_modules) to the server, then:
npm install --omit=dev

# 2. Database — reuse your existing Postgres:
sudo -u postgres createuser denzero -P        # pick a password
sudo -u postgres createdb denzero -O denzero
psql postgres://denzero:PASS@localhost:5432/denzero -f schema.sql

# 3. Configure
cp .env.example .env   # set DATABASE_URL, PORT, ADMIN_PASS

# 4. Keep it alive
npm i -g pm2
pm2 start server.js --name denzero
pm2 save && pm2 startup

# 5. nginx in front (HTTPS via certbot)
```

nginx site config:

```nginx
server {
    server_name register.denzero.in;          # your domain
    client_max_body_size 16M;                  # decks up to 10 MB

    location / {
        proxy_pass http://127.0.0.1:8642;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
sudo certbot --nginx -d register.denzero.in   # free HTTPS
```

## Backups (do this)

```bash
# crontab -e  → nightly at 2 AM
0 2 * * * pg_dump denzero > /backups/denzero-$(date +\%F).sql && tar czf /backups/uploads-$(date +\%F).tgz /path/to/Den_zero/uploads
```

## Before going live

- [ ] Replace `denzero@upi` in `public/index.html` with the real UPI VPA
- [ ] Replace `hello@denzero.in` contact email on the success screen
- [ ] Set a strong `ADMIN_PASS` in `.env`
- [ ] Run one test registration, verify it in `/admin`, then delete it:
      `DELETE FROM registrations;` and clear `uploads/decks` + `uploads/payments`
