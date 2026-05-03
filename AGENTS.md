# Smart Print Queue System - Agent Instructions

This document provides conventions and context for AI coding agents working on the Smart Print Queue System.

## Architecture & Stack

- **Backend:** Python / [FastAPI](main.py)
- **Frontend:** Vanilla HTML, CSS, JavaScript (no framework) in the `public/` directory
- **Storage:** In-memory queue (resets on server restart) and local file storage (`uploads/`)

## Build & Run Commands

- **Install dependencies:** `pip install -r requirements.txt`
- **Run local server:** `uvicorn main:app --reload --host 0.0.0.0 --port 3000`

## Core Conventions

- **Minimal Frontend:** Keep the frontend framework-free to maintain the prototype's simplicity. Use vanilla JS and CSS.
- **Backend State:** The queue state is managed in-memory in `main.py`. Maintain consistency with the pre-defined constants (`STATUS_WAITING`, `STATUS_PRINTING`, etc.).
- **Privacy First:** Ensure uploaded files in `uploads/` continue to have strict cleanup rules upon job completion or ticket expiration.

For full endpoint definitions, features, and setup details, please reference the [README.md](README.md).
