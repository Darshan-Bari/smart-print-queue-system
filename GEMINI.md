# Smart Print Queue System

A simple, explainable print queue prototype designed for college-area print shops. It allows students to upload files, receive a token, and track their print status.

## Project Overview

- **Purpose:** Provide a lightweight, easy-to-understand print management system.
- **Backend:** [FastAPI](https://fastapi.tiangolo.com/) (Python) handles API requests and serves static files.
- **Frontend:** Plain HTML, CSS, and JavaScript (Vanilla JS, no frameworks).
- **Storage:** 
  - **Queue Data:** Managed in-memory within `main.py` (resets on server restart).
  - **Files:** Temporarily stored in the `uploads/` directory.

## Key Files

- `main.py`: The core FastAPI application containing all API endpoints and queue logic.
- `public/`: Contains the frontend assets:
  - `index.html`: Student file upload form.
  - `status.html`: Token tracking page.
  - `admin.html`: Administrator dashboard for managing the queue.
  - `api-client.js`: Common utility for making API requests.
  - `app.js`, `status.js`, `admin.js`: Page-specific logic.
- `uploads/`: Directory where uploaded print files are stored.

## Building and Running

### Prerequisites

- Python 3.8+
- `pip` (Python package manager)

### Installation

1. Create and activate a virtual environment (optional but recommended):
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

### Running the Application

Start the FastAPI server using Uvicorn:

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 3000
```

The application will be available at:
- **Student Upload:** `http://localhost:3000`
- **Queue Status:** `http://localhost:3000/status.html`
- **Admin Dashboard:** `http://localhost:3000/admin.html`

## Development Conventions

- **API Design:** Follows RESTful principles where possible.
- **Concurrency:** Uses `async`/`await` for non-blocking I/O operations in FastAPI.
- **Queue Logic:** Statuses include `Waiting`, `Printing`, `Ready`, `Completed`, and `Expired`.
- **Privacy:** Files are automatically deleted from `uploads/` upon job completion or expiry (30-minute lifetime by default).
- **Styling:** Custom CSS in `public/styles.css`, following a clean and simple design.
