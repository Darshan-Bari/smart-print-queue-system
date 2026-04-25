import asyncio
import os
import random
import re
import shutil
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles


# Basic app setup
app = FastAPI(title="Smart Print Queue")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)


# Constants used by the project
UPLOAD_LIFETIME_MINUTES = 30
STATUS_WAITING = "Waiting"
STATUS_PRINTING = "Printing"
STATUS_READY = "Ready"
STATUS_COMPLETED = "Completed"
STATUS_EXPIRED = "Expired"
ACTIVE_QUEUE_STATUSES = [STATUS_WAITING, STATUS_PRINTING]
ALLOWED_PRINT_TYPES = ["Black & White", "Color"]
ALLOWED_STATUS_UPDATES = [
    STATUS_WAITING,
    STATUS_PRINTING,
    STATUS_READY,
    STATUS_COMPLETED,
]


# Folders
BASE_DIR = Path(__file__).resolve().parent
UPLOADS_DIR = BASE_DIR / "uploads"
PUBLIC_DIR = BASE_DIR / "public"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


# In-memory data (easy for first-year project demo)
next_token_number = 1
print_requests = []
print_request_lookup = {}
server_start_time = time.monotonic()


def utc_now():
    return datetime.now(timezone.utc)


def isoformat_utc(value):
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def now_iso():
    return isoformat_utc(utc_now())


def parse_iso(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def make_token():
    global next_token_number
    token = f"T-{next_token_number:03d}"
    token_index = next_token_number
    next_token_number += 1
    return token, token_index


def safe_upload_name(original_name):
    safe = re.sub(r"[^a-zA-Z0-9._-]", "_", original_name)
    return f"{int(time.time() * 1000)}-{random.randint(0, 999999999)}-{safe}"


def find_request(token_number):
    return print_request_lookup.get(token_number.upper())


def get_active_queue():
    active = [item for item in print_requests if item["status"] in ACTIVE_QUEUE_STATUSES]
    active.sort(key=lambda x: x["tokenIndex"])
    return active


def calculate_job_minutes(item):
    base = 4 if item["printType"] == "Color" else 3
    extra = max(item["copies"] - 1, 0) * 0.5
    return int(base + extra + 0.9999)


def get_queue_position(item):
    if item["status"] == STATUS_READY:
        return 0

    if item["status"] not in ACTIVE_QUEUE_STATUSES:
        return 0

    active = get_active_queue()
    for i, request_item in enumerate(active):
        if request_item["tokenNumber"] == item["tokenNumber"]:
            return i + 1
    return 0


def get_wait_minutes(item):
    if item["status"] in [STATUS_READY, STATUS_COMPLETED, STATUS_EXPIRED]:
        return 0

    active = get_active_queue()
    current_index = -1

    for i, request_item in enumerate(active):
        if request_item["tokenNumber"] == item["tokenNumber"]:
            current_index = i
            break

    if current_index == -1:
        return 0

    jobs_ahead = active[:current_index]
    wait = 0
    for request_item in jobs_ahead:
        wait += calculate_job_minutes(request_item)

    if item["status"] == STATUS_PRINTING:
        return max(1, (calculate_job_minutes(item) + 1) // 2)

    return wait + calculate_job_minutes(item)


def build_queue_metadata():
    active = get_active_queue()
    positions = {}
    wait_times = {}
    accumulated_wait = 0

    for index, request_item in enumerate(active, start=1):
        token_number = request_item["tokenNumber"]
        positions[token_number] = index

        if request_item["status"] == STATUS_PRINTING:
            wait_times[token_number] = max(1, (calculate_job_minutes(request_item) + 1) // 2)
        else:
            wait_times[token_number] = accumulated_wait + calculate_job_minutes(request_item)

        accumulated_wait += calculate_job_minutes(request_item)

    return {"positions": positions, "wait_times": wait_times}


def remove_storage_file(storage_path):
    try:
        Path(storage_path).unlink()
    except FileNotFoundError:
        pass


def cleanup_storage_path(storage_path):
    try:
        remove_storage_file(storage_path)
    except Exception:
        pass


def parse_copies_value(copies):
    try:
        copies_value = int(copies)
    except Exception as error:
        raise HTTPException(status_code=400, detail="Copies must be a number between 1 and 100.") from error

    if copies_value < 1 or copies_value > 100:
        raise HTTPException(status_code=400, detail="Copies must be a number between 1 and 100.")

    return copies_value


def validate_print_type(print_type):
    if print_type not in ALLOWED_PRINT_TYPES:
        raise HTTPException(status_code=400, detail="Please select a valid print type.")


async def validate_upload_file(print_file):
    if print_file is None:
        raise HTTPException(status_code=400, detail="Please upload a PDF or image file.")

    content_type = (print_file.content_type or "").lower()
    is_pdf = content_type == "application/pdf"
    is_image = content_type.startswith("image/")

    if is_pdf or is_image:
        return

    await print_file.close()
    raise HTTPException(status_code=400, detail="Only PDF and image files are allowed.")


def create_request_item(*, token_number, token_index, student_name, file_name, storage_path, copies, print_type):
    created_at = utc_now()
    created_at_iso = isoformat_utc(created_at)

    return {
        "tokenNumber": token_number,
        "tokenIndex": token_index,
        "studentName": student_name.strip() or "Anonymous Student",
        "fileName": file_name or "uploaded-file",
        "storagePath": str(storage_path),
        "copies": copies,
        "printType": print_type,
        "status": STATUS_WAITING,
        "createdAt": created_at_iso,
        "updatedAt": created_at_iso,
        "expiresAt": isoformat_utc(created_at + timedelta(minutes=UPLOAD_LIFETIME_MINUTES)),
        "fileDeleted": False,
    }


def delete_file_for_request(item, reason):
    if item["fileDeleted"] or not item["storagePath"]:
        return

    try:
        remove_storage_file(item["storagePath"])
    except FileNotFoundError:
        pass
    except Exception as error:
        print("File delete failed:", error)

    item["fileDeleted"] = True
    item["storagePath"] = None
    item["deletionReason"] = reason
    item["deletedAt"] = now_iso()


def expire_old_requests():
    now = utc_now()
    now_value = isoformat_utc(now)

    for item in print_requests:
        if item["fileDeleted"]:
            continue

        expires_at = parse_iso(item["expiresAt"])
        can_expire = item["status"] not in [STATUS_COMPLETED, STATUS_EXPIRED]

        if now >= expires_at and can_expire:
            item["status"] = STATUS_EXPIRED
            item["updatedAt"] = now_value
            delete_file_for_request(item, "expired")


def build_stats():
    stats = {
        "total": len(print_requests),
        "waiting": 0,
        "printing": 0,
        "ready": 0,
        "completed": 0,
        "expired": 0,
    }

    for item in print_requests:
        status = item["status"].lower()
        if status in stats:
            stats[status] += 1

    return stats


def serialize_request(item, queue_metadata=None):
    queue_metadata = queue_metadata or {}
    positions = queue_metadata.get("positions", {})
    wait_times = queue_metadata.get("wait_times", {})
    file_url = None
    if not item["fileDeleted"] and item["storagePath"]:
        file_url = f"/uploads/{Path(item['storagePath']).name}"

    if item["status"] == STATUS_READY:
        queue_position = 0
    else:
        queue_position = positions.get(item["tokenNumber"])
        if queue_position is None:
            queue_position = get_queue_position(item)

    if item["status"] in [STATUS_READY, STATUS_COMPLETED, STATUS_EXPIRED]:
        wait_minutes = 0
    else:
        wait_minutes = wait_times.get(item["tokenNumber"])
        if wait_minutes is None:
            wait_minutes = get_wait_minutes(item)

    return {
        "tokenNumber": item["tokenNumber"],
        "tokenIndex": item["tokenIndex"],
        "studentName": item["studentName"],
        "fileName": item["fileName"],
        "copies": item["copies"],
        "printType": item["printType"],
        "status": item["status"],
        "createdAt": item["createdAt"],
        "updatedAt": item["updatedAt"],
        "expiresAt": item["expiresAt"],
        "queuePosition": queue_position,
        "estimatedWaitTimeMinutes": wait_minutes,
        "fileDeleted": item["fileDeleted"],
        "fileUrl": file_url,
        "deletionReason": item.get("deletionReason"),
        "privacyMessage": "Your file will be automatically deleted after printing for privacy.",
    }


@app.exception_handler(HTTPException)
async def handle_http_exception(_request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"message": str(exc.detail)})


@app.exception_handler(Exception)
async def handle_unknown_exception(_request: Request, exc: Exception):
    print("Unhandled error:", exc)
    return JSONResponse(status_code=500, content={"message": "Something went wrong."})


async def auto_expire_loop():
    while True:
        try:
            expire_old_requests()
        except Exception as error:
            print("Expiry loop error:", error)
        await asyncio.sleep(60)


@app.on_event("startup")
async def startup_event():
    app.state.expiry_task = asyncio.create_task(auto_expire_loop())


@app.on_event("shutdown")
async def shutdown_event():
    expiry_task = getattr(app.state, "expiry_task", None)
    if expiry_task:
        expiry_task.cancel()


@app.get("/api/health")
async def health_check():
    return {
        "ok": True,
        "uptimeSeconds": round(time.monotonic() - server_start_time),
    }


@app.post("/api/requests")
async def create_request(
    printFile: UploadFile = File(default=None),
    name: str = Form(default=""),
    copies: str = Form(default=""),
    printType: str = Form(default=""),
):
    expire_old_requests()
    await validate_upload_file(printFile)

    unique_name = safe_upload_name(printFile.filename or "upload")
    storage_path = UPLOADS_DIR / unique_name

    try:
        with storage_path.open("wb") as f:
            shutil.copyfileobj(printFile.file, f)

        copies_value = parse_copies_value(copies)
        validate_print_type(printType)
        token_number, token_index = make_token()
        item = create_request_item(
            token_number=token_number,
            token_index=token_index,
            student_name=name,
            file_name=printFile.filename,
            storage_path=storage_path,
            copies=copies_value,
            print_type=printType,
        )

        print_requests.append(item)
        print_request_lookup[item["tokenNumber"]] = item
        return JSONResponse(status_code=201, content=serialize_request(item))
    except HTTPException:
        cleanup_storage_path(storage_path)
        raise
    except Exception as error:
        print("Create request failed:", error)
        cleanup_storage_path(storage_path)
        raise HTTPException(status_code=500, detail="Could not create the print request.")
    finally:
        await printFile.close()


@app.get("/api/requests/{token_number}")
async def get_request(token_number: str):
    expire_old_requests()
    item = find_request(token_number)

    if item is None:
        raise HTTPException(status_code=404, detail="Token not found.")

    return serialize_request(item, build_queue_metadata())


@app.get("/api/queue")
async def get_queue():
    expire_old_requests()
    queue_metadata = build_queue_metadata()

    items = sorted(
        print_requests,
        key=lambda x: (x["status"] == STATUS_COMPLETED, x["tokenIndex"]),
    )

    return {
        "items": [serialize_request(x, queue_metadata) for x in items],
        "stats": build_stats(),
    }


@app.patch("/api/requests/{token_number}/status")
async def update_status(token_number: str, request: Request):
    expire_old_requests()
    item = find_request(token_number)

    if item is None:
        raise HTTPException(status_code=404, detail="Token not found.")

    if item["status"] == STATUS_EXPIRED:
        raise HTTPException(status_code=400, detail="Expired requests cannot be updated.")

    try:
        body = await request.json()
    except Exception:
        body = {}

    next_status = body.get("status") if isinstance(body, dict) else None

    if next_status not in ALLOWED_STATUS_UPDATES:
        raise HTTPException(status_code=400, detail="Invalid status.")

    item["status"] = next_status
    item["updatedAt"] = now_iso()

    if next_status == STATUS_COMPLETED:
        delete_file_for_request(item, "completed")

    return serialize_request(item)


@app.delete("/api/requests/{token_number}/file")
async def delete_request_file(token_number: str):
    expire_old_requests()
    item = find_request(token_number)

    if item is None:
        raise HTTPException(status_code=404, detail="Token not found.")

    if item["fileDeleted"] or not item["storagePath"]:
        raise HTTPException(status_code=400, detail="File already deleted.")

    delete_file_for_request(item, "manual")
    item["updatedAt"] = now_iso()

    return serialize_request(item)


app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")
app.mount("/", StaticFiles(directory=str(PUBLIC_DIR), html=True), name="public")


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "3000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
