# Smart Print Queue System

This project is a simple, explainable print queue prototype for college-area print shops.

- Frontend: plain HTML, CSS, JavaScript (no framework)
- Backend: FastAPI (Python)
- Storage: local file uploads + in-memory queue

## Features (unchanged)

- Student upload form (PDF or image)
- Token generation (`T-001`, `T-002`, ...)
- Queue tracking page with auto refresh
- Admin dashboard to update status (`Waiting`, `Printing`, `Ready`, `Completed`)
- Manual file delete from admin dashboard
- Automatic privacy delete on completion/expiry
- Queue stats (`total`, `waiting`, `printing`, `ready`, `completed`, `expired`)

## Project Structure

```
main.py
public/
	index.html
	status.html
	admin.html
	styles.css
	api-client.js
	app.js
	status.js
	admin.js
uploads/
requirements.txt
```

## Run Locally

1. Install dependencies:

```bash
pip install -r requirements.txt
```

2. Start the server:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 3000
```

3. Open:

- `http://localhost:3000` (upload)
- `http://localhost:3000/status.html` (track token)
- `http://localhost:3000/admin.html` (admin dashboard)

## API Endpoints

- `GET /api/health`
- `POST /api/requests` (multipart: `printFile`, `name`, `copies`, `printType`)
- `GET /api/requests/{tokenNumber}`
- `GET /api/queue`
- `PATCH /api/requests/{tokenNumber}/status`
- `DELETE /api/requests/{tokenNumber}/file`

## Notes

- Queue state is in-memory, so restarting the server resets active requests.
- Uploads are stored in `uploads/` and removed after completion/expiry for privacy.
