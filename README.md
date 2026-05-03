# Smart Print Queue System

This project is a simple, explainable print queue prototype for college-area print shops.

- Frontend: plain HTML, CSS, JavaScript (no framework)
- Backend: FastAPI (Python)
- Storage: local file uploads + in-memory queue

## Features (unchanged)

- Student upload form (PDF or image)
- Token generation (`1`, `2`, ...)
- Queue tracking page with auto refresh
- Admin dashboard to update status (`Waiting`, `Printing`, `Ready`, `Completed`)
- Manual file delete from admin dashboard
- Automatic privacy delete on completion/expiry
- Queue stats (`total`, `waiting`, `printing`, `ready`, `completed`, `expired`)

## Project Structure

````
main.py
public/
	index.html
	status.html
	admin.html
	# Smart Print Queue System

	Lightweight FastAPI-backed print queue prototype with a minimal vanilla-JS frontend.

	This README has been updated to reflect recent additions: LAN share QR, mobile UI rules, admin mobile restrictions, UPI integration placeholder, improved file lifecycle handling, and a small config endpoint.

	Contents
	- Overview
	- Run / develop
	- Frontend
	- Backend & API
	- File lifecycle & privacy
	- Configuration / environment
	- Dependencies
	- Troubleshooting

	Overview
	 - Simple upload UI for students (PDF / image / PPTX) to request prints.
	 - Admin dashboard to monitor queue, update status, preview/print files, and delete uploaded files.
	 - In-memory queue state (reset on server restart) and local file storage under `uploads/`.

	Run / develop
	1. Install dependencies:

	```bash
	pip install -r requirements.txt
	```

	2. Run the app locally (defaults to port 3000):

	```bash
	uvicorn main:app --reload --host 0.0.0.0 --port 3000
	```

	3. Open the UI in your browser:
	- `/` → upload page
	- `/status.html` → student-facing status tracker (use `?token=<token>` to show a token)
	- `/admin.html` → admin dashboard (desktop only; mobile displays a notice)

	Frontend
	- Files: the client is in the `public/` folder: `index.html`, `status.html`, `admin.html`, `styles.css`, and JS helpers (`api-client.js`, `app.js`, `status.js`, `admin.js`).
	- `api-client.js` exposes `API_BASE_URL` support: you can set `window.API_BASE_URL` in pages to point requests to a custom base (useful behind proxies).
	- UPI: `api-client.js` contains a `SHOP_UPI_ID` constant for a shop UPI id placeholder used by the frontend UI for payments. Update it in `public/api-client.js`.
	- QR / Share: the admin "Share App QR" generates a QR for a server-provided LAN URL so other devices on your Wi‑Fi can open the app (see Backend & API).
	- Mobile UI: header/navigation optimized for small screens; the three top buttons are shown compactly. The admin link is hidden on small screens and `/admin.html` shows a short notice on devices <= 720px.

	Backend & API
	- Backend: single-file FastAPI app at `main.py`.
	- The server serves static files from `public/` and uploads from `uploads/`.

	Important endpoints
	- `GET /api/health` — basic health check
	- `POST /api/requests` — create a print request (multipart/form-data). Fields: `printFiles[]` (files), `name`, `remark`, `copies`, `printType`, `paymentMethod`.
	- `GET /api/requests/{tokenNumber}` — get a single request
	- `GET /api/queue` — list queue items + `stats` and metadata (positions/wait times)
	- `PATCH /api/requests/{tokenNumber}/status` — update print status (`Waiting`, `Printing`, `Ready`, `Completed`)
	- `PATCH /api/requests/{tokenNumber}/payment` — update payment status (`Paid`/`Unpaid`)
	- `DELETE /api/requests/{tokenNumber}/file` — delete uploaded file(s) for privacy
	- `GET /api/config` — lightweight config endpoint that returns a server-detected share URL (e.g. `{"websiteUrl":"http://192.168.x.y:3000"}`) used by the admin QR

	Server behavior & conventions
	- Queue state is in-memory: the arrays `print_requests` and `print_request_lookup` live inside `main.py` and reset when the server restarts.
	- Upload lifetime: uploads are considered private and are scheduled for automatic deletion after `UPLOAD_LIFETIME_MINUTES` (default: 30). Expired requests will have their files deleted and the `fileDeleted` flag set.
	- File deletion behavior: when a delete is performed (manual or expiry) the file is removed from disk (`uploads/`), `fileDeleted` is set to `true`, `deletionReason` is set (`manual` or `expired`), and `deletedAt` timestamp is recorded. The API serialization then omits file URLs when `fileDeleted` is true.
	- Allowed print types: `Black & White`, `Color` (check `ALLOWED_PRINT_TYPES` in `main.py`).

	Files & storage
	- Uploaded files are stored in `uploads/` with safe, timestamped filenames. The admin UI shows available View/Print links while files exist.
	- The `uploads/` directory is managed by the server; files are removed after manual deletion or expiry for privacy.

	Configuration & environment
	- `PORT` — set to change the server port (default 3000). The `GET /api/config` helper uses `PORT` to build the share URL.
	- `get_share_url()` — server helper (in `main.py`) attempts to auto-detect the LAN IP and returns `http://<lan-ip>:<port>` for the admin QR.
	- `API_BASE_URL` — client-side override (set `window.API_BASE_URL` before client scripts run to point the frontend to a different base path or proxy).

	Dependencies
	- See `requirements.txt` (FastAPI, Uvicorn, python-multipart, pypdf, python-pptx).

	Notes for developers
	- The project is intentionally simple and framework-free on the frontend to ease demonstration and review.
	- To change the UPI placeholder, edit `public/api-client.js` and update `SHOP_UPI_ID`.
	- To force a different share URL (for demonstration or tunnels), either configure a reverse proxy or modify `get_share_url()` in `main.py`.

	Troubleshooting
	- If the admin UI shows "File deleted for privacy" but you expect a file to exist, check the server logs for expiry or manual deletion calls. The serialized item contains `fileDeleted` and `deletionReason` fields.
	- If the QR points to the wrong address on your network, you can set `PORT` or adjust `get_lan_ip()` in `main.py` to select a different interface.

	Contributing
	- Make small, focused edits and include changes to `README.md` when you alter behavior that affects users (mobile rules, share URL behavior, file retention).

	License
	- (None specified) — add a license file if you plan to open source or share this project widely.
````
