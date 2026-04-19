# Smart Print Queue and Pre-Upload System

A beginner-friendly web prototype for college-area print shops. Students can upload a file, receive a token number, track queue progress, and pick up prints later. Admins can manage the print queue from a simple dashboard.

## Features

- File upload for PDF and image files
- Token generation with live queue position and estimated wait time
- Student tracking page with status updates
- Admin dashboard for queue management
- Automatic file deletion on completion
- Automatic file expiry after 30 minutes for privacy

## Run Locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the server:

   ```bash
   npm start
   ```

3. Open the app:

   - User upload page: `http://localhost:3000/`
   - Status page: `http://localhost:3000/status.html?token=T-001`
   - Admin dashboard: `http://localhost:3000/admin.html`

## Dependencies

- `express`
- `multer`

## Notes

- Uploaded files are stored temporarily inside `/uploads`.
- Files are deleted as soon as the job is marked `Completed`.
- Files are also deleted automatically after 30 minutes if the request is not completed in time.
- This project uses in-memory storage for queue data, so restarting the server clears the queue.
