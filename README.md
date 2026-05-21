# 🖼️ Synology Photos Slideshow

A lightweight, Docker-based web slideshow that streams photos and GIFs directly from your Synology NAS using the official Photos API. Features album & conditional album selection, smart GIF timing, automatic caching, and a secure admin interface.

---

## 📋 Prerequisites
- Synology NAS running **DSM 7.0+** with **Photos** station installed
- User account with **read access** to Photos
- **2FA (TOTP)** enabled on the Synology account
- Docker / Container Manager installed on the NAS
- Local network access (or reverse proxy if exposing externally)

---

## you can download this git as a zip and extract the files and templates into where you will build and host your slideshow server

## ⚙️ Environment Setup (`.env`)

Create a file named `.env` in your project root with the following variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `NAS_URL` | Full HTTPS address of your NAS web portal | `https://192.168.1.36:5035` |
| `SYNO_USER` | Username with Photos read access | `your_syno_username` |
| `SYNO_PASS` | Password for the Synology user | `your_syno_password` |
| `ADMIN_TOKEN` | Secret used to log into `admin.html` (recommended: 20+ chars, mixed case/numbers/symbols) | `Kx9#mP2$vLq8!nR5wY7@zA` |
| `TOTP_SECRET` | **Base32 secret** from Synology 2FA setup (not the 6-digit code) | `JBSWY3DPEHPK3PXP` |
| `PORT` | (Optional) Container port. Defaults to `3000` | `3000` |

> 🔒 **Security Note:** Never commit `.env` to version control. Rotate `ADMIN_TOKEN` if exposed. The token is **only** for the slideshow admin UI, not your Synology account.

---

## 🐳 Installation & Deployment

1. **Create project directory & files:**
   ```bash
   mkdir -p /volume1/docker/slideshow/public
   cd /volume1/docker/slideshow
   # Place server.js, Dockerfile, public/admin.html, public/slideshow.html here

2. **Create .env with variables above**

3. **Build & Run
docker build --no-cache -t slideshow-server:latest .
docker run -d \
  --name syno-photos-slideshow \
  -p 13535:3000 \
  -e NAS_URL=nas \
  -e SYNO_USER=your_user \
  -e SYN_PASS=your_pass \
  -e ADMIN_TOKEN=your_token \
  -e TOTP_SECRET=your_2fa_secret \
  -v /etc/localtime:/etc/localtime:ro \
  slideshow-server:latest

*⏱️ Time Sync Required: -v /etc/localtime:/etc/localtime:ro is mandatory. TOTP authentication will fail or loop if the container clock drifts from the NAS.*
