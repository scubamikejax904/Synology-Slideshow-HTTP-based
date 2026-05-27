# 🖼️ Synology Photos Slideshow

A lightweight, Docker-based web slideshow that streams photos and GIFs directly from your Synology NAS using the official Photos API. Features album & conditional album selection, smart GIF timing, automatic caching, and a secure admin interface.

**No Warranties expressed or implied, Code is offered as is**

---

## 📋 Prerequisites
- Synology NAS running **DSM 7.0+** with **Photos** station installed
- User account with **read access** to Photos
- **2FA (TOTP)** enabled on the Synology account **Optoional**
- Docker / Container Manager installed on the NAS
- Local network access (or reverse proxy if exposing externally)

---

## ⚙️ Environment Setup (`.env`)

Create a file named `.env` in your project root (`/volume1/docker/slideshow/`) with the following variables:

| Variable | Description | Example |
|----------|-------------|---------|
| `NAS_URL` | Full HTTPS address of your NAS web portal with port | `https://192.168.1.2:5001` |
| `SYNO_USER` | Username with Photos read access | `your_syno_username` |
| `SYNO_PASS` | Password for the Synology user | `your_syno_password` |
| `ADMIN_TOKEN` | Secret used to log into `admin.html` (recommended: 20+ chars) | `Kx9#mP2$vLq8!nR5wY7@zA` |
| `TOTP_SECRET` | **Base32 secret** from Synology 2FA setup (not the 6-digit code) | `JBSWY3DPEHPK3PXP` |
| `PORT` | Container port. Defaults to `3000` **don't change**| `3000` |

> 🔒 **Security Note:** Never commit `.env` to version control. Rotate `ADMIN_TOKEN` if exposed.

---

## 🐳 Installation & Deployment
*******I used Container Manager to build this project on my Synology NAS, The below docker commands are AI generated and untested*******

## See further below for Synology container manager instructions


1. **Create project directory & files:**

        mkdir -p /volume1/docker/slideshow/public
        cd /volume1/docker/slideshow
        # Place server.js, Dockerfile, public/admin.html, public/slideshow.html here

2. **Create `.env`** with the variables above and save it in /slideshow with the Dockerfile

3. **Build & Run:**

        docker build --no-cache -t slideshow-server:latest .
        
        docker run -d \
          --name syno-photos-slideshow \
          -p 13535:3000 \ #Change outward port number if necessary
          --env-file .env \
          -v /etc/localtime:/etc/localtime:ro \
          -v $(pwd)/config.json:/app/config.json \
          slideshow-server:latest

> ⏱️ **Time Sync Required:** `-v /etc/localtime:/etc/localtime:ro` is mandatory. TOTP authentication will fail or loop if the container clock drifts from the NAS.
Go to Configuration & Usage below

---

## Container Manager Instructions 
1. Open file station and create a working directory named syno-slideshow (in your docker directory)
   ex /volumd1/docker/syno-slideshow
2. Download Github as Zip click code and download as zip
   https://github.com/scubamikejax904/Synology-Slideshow-HTTP-based
3. Extract all files into your working directory

4. Edit the .env file using below table
   
| Variable | Description | Example |
|----------|-------------|---------|
| `NAS_URL` | Full HTTPS address of your NAS web portal with port | `https://192.168.1.2:5001` |
| `SYNO_USER` | Username with Photos read access | `your_syno_username` |
| `SYNO_PASS` | Password for the Synology user | `your_syno_password` |
| `ADMIN_TOKEN` | Secret used to log into `admin.html` (recommended: 20+ chars) | `Kx9#mP2$vLq8!nR5wY7@zA` |
| `TOTP_SECRET` | **Base32 secret** from Synology 2FA setup (not the 6-digit code) | `JBSWY3DPEHPK3PXP` |
| `PORT` | Container port. Defaults to `3000` **don't change**| `3000` |

> 🔒 **Security Note:** Never commit `.env` to version control. Rotate `ADMIN_TOKEN` if exposed.


5. Open Container Manager
6. Click project
7. Click Create
8. Give your project a name (syno-slideshow) or whatever you want to call it
9. click path and point it to your working directory
           When it pops up asking about using the docker-compose.ymal in the path make sure use existing is selected and press ok
 10. The Docker-compose comes up here is where you make your changes to TZ (Use https://timezone.mariushosting.com or   https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) and volumes make sure the paths are correct to your working directory
 11. You can ignore setting up web portal (I'm not exactly sure what it does, I have and haven't used it in the past with the same results        so I ignore it and Click Next
 12. Make sure Start the project once it is created is selected and click done and wait for it to build
 13. Once Build completes click close and proceed below to Configuration & Usage
---

## 🖥️ Configuration & Usage

1. **Access Admin UI:** `http://<NAS_IP>:<port>/admin.html`
2. **Login** using your `ADMIN_TOKEN`
3. **Select Albums:** Search & check regular or conditional albums
4. **Adjust Settings:**
   - `Interval`: Seconds between slides (static images)
   - `Image Quality`: `xl`, `l`, `m`, `s`
   - `Shuffle Photos`: Randomize playback order
5. **Save** → Settings are stored in `config.json`
6. **View Slideshow:** `http://<NAS_IP>:<port>/slideshow.html` (or `/` depending on your routing)
7. **Force Clear Config:** Click `🗑️ Force Clear Config` in admin UI to reset all selections if UI desync occurs.

---

## 🏷️ Using Tags via Conditional Albums

Due to DSM API limitations, direct tag filtering is not supported on most DSM 7.x versions. Use this reliable workaround:

### Step-by-Step in Synology Photos:
1. Open **Photos** → Go to **Albums**
2. Click **Create Album** → Select **Conditional Album**
3. Click **Add Condition** → Select **Tag**
4. Set operator to **is** → Search & select your desired tag
5. Name the album (e.g., `🏷️ Tag: Beach Vacation`)
6. Click **Create**

### In Slideshow Admin:
- The new conditional album will appear in the album list with a `⚙️` badge
- Select it and save → The slideshow will now show only photos with that tag
- You can create one conditional album per tag for full tag-based curation

---

## 🛠️ Troubleshooting

| Issue | Solution |
|-------|----------|
| `Waiting Xms for next OTP window...` loop | Ensure `-v /etc/localtime:/etc/localtime:ro` is mounted. Verify `TOTP_SECRET` matches Synology 2FA setup. |
| Images fail to load / 401 errors | Check `SYNO_USER`/`SYNO_PASS` permissions. Ensure account has Photos read access. |
| Admin UI shows checked boxes but no albums selected | Click `🗑️ Force Clear Config`, then re-select. Hard-reload browser (`Ctrl+Shift+R`). |
| `(node:1) Warning: NODE_TLS_REJECT_UNAUTHORIZED...` | Normal for self-signed NAS certs. Safe to ignore in local networks. |
| GIFs play too fast | The frontend auto-detects `.gif` files and applies a 10-second display window. |
| Container won't start / port conflict | Run `docker ps` to check port usage. Change `-p 13535:3000` to an available host port. |

---

## 📝 Notes & Limitations
- ✅ **Works on:** DSM 7.1 / 7.2 (tested)
- ✅ **Supported Media:** JPEG, PNG, WebP, GIF (animated)
- ⚠️ **Video Support:** Not included due to high bandwidth/buffering impact. Use optimized GIFs instead.
- ⚠️ **Tag API:** Direct `general_tag_id` filtering is ignored by Synology. Use the Conditional Album workaround above.
- 🔐 **Security:** The admin UI requires token authentication. Do not expose your port publicly without a reverse proxy & HTTPS.
- 💾 **Persistence:** `config.json` and `.env` survive container rebuilds. Docker images can be safely removed/rebuilt.

---

## 🔄 Maintenance

To update or rebuild the container:

    docker stop syno-photos-slideshow && docker rm syno-photos-slideshow
    docker rmi slideshow-server:latest
    docker build --no-cache -t slideshow-server:latest .
    
    docker run -d \
      --name syno-photos-slideshow \
      -p 13535:3000 \
      --env-file .env \
      -v /etc/localtime:/etc/localtime:ro \
      -v $(pwd)/config.json:/app/config.json \
      slideshow-server:latest

---
*Built for local kiosk/display use. Streams directly from NAS without storing duplicates.* 🖼️✨
