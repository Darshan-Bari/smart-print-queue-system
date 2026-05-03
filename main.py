import asyncio
import os
import random
import re
import shutil
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List

import pypdf
import pptx
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
    token = f"{next_token_number}"
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
        raise HTTPException(status_code=400, detail="Please upload a PDF, PPTX, or image file.")

    content_type = (print_file.content_type or "").lower()
    is_pdf = content_type == "application/pdf"
    is_image = content_type.startswith("image/")
    is_pptx = "presentation" in content_type or "powerpoint" in content_type or (print_file.filename or "").lower().endswith((".pptx", ".ppt"))

    if is_pdf or is_image or is_pptx:
        return

    await print_file.close()
    raise HTTPException(status_code=400, detail="Only PDF, PPTX, and image files are allowed.")


def get_page_count(storage_path, content_type, filename):
    content_type = (content_type or "").lower()
    filename = (filename or "").lower()
    try:
        if "pdf" in content_type or filename.endswith(".pdf"):
            reader = pypdf.PdfReader(str(storage_path))
            return len(reader.pages)
        elif "presentation" in content_type or "powerpoint" in content_type or filename.endswith((".pptx", ".ppt")):
            prs = pptx.Presentation(str(storage_path))
            return len(prs.slides)
    except Exception as e:
        print("Page count error:", e)
    return 1


def create_request_item(*, token_number, token_index, student_name, files_data, copies, print_type, payment_method, page_count):
    created_at = utc_now()
    created_at_iso = isoformat_utc(created_at)

    total_cost = (2 if print_type == "Black & White" else 6) * copies * page_count

    return {
        "tokenNumber": token_number,
        "tokenIndex": token_index,
        "studentName": student_name.strip() or "Anonymous Student",
        "files": files_data,
        "copies": copies,
        "printType": print_type,
        "paymentMethod": payment_method,
        "paymentStatus": "Unpaid",
        "totalCost": total_cost,
        "status": STATUS_WAITING,
        "createdAt": created_at_iso,
        "updatedAt": created_at_iso,
        "expiresAt": isoformat_utc(created_at + timedelta(minutes=UPLOAD_LIFETIME_MINUTES)),
        "fileDeleted": False,
    }


def delete_file_for_request(item, reason):
    if item["fileDeleted"]:
        return

    for f in item.get("files", []):
        try:
            if f.get("storagePath"):
                remove_storage_file(f["storagePath"])
        except FileNotFoundError:
            pass
        except Exception as error:
            print("File delete failed:", error)

    item["fileDeleted"] = True
    for f in item.get("files", []):
        f["storagePath"] = None
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
    
    file_urls = []
    if not item["fileDeleted"]:
        for f in item.get("files", []):
            if f.get("storagePath"):
                file_urls.append({
                    "fileName": f["fileName"],
                    "fileUrl": f"/uploads/{Path(f['storagePath']).name}"
                })

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
        "files": file_urls,
        "copies": item["copies"],
        "printType": item["printType"],
        "paymentMethod": item.get("paymentMethod", "Cash"),
        "paymentStatus": item.get("paymentStatus", "Unpaid"),
        "totalCost": item.get("totalCost", 0),
        "status": item["status"],
        "createdAt": item["createdAt"],
        "updatedAt": item["updatedAt"],
        "expiresAt": item["expiresAt"],
        "queuePosition": queue_position,
        "estimatedWaitTimeMinutes": wait_minutes,
        "fileDeleted": item["fileDeleted"],
        "deletionReason": item.get("deletionReason"),
        "privacyMessage": "Your files will be automatically deleted after printing for privacy.",
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
    printFiles: List[UploadFile] = File(...),
    name: str = Form(default=""),
    copies: str = Form(default=""),
    printType: str = Form(default=""),
    paymentMethod: str = Form(default="Cash"),
):
    expire_old_requests()

    if not printFiles:
        raise HTTPException(status_code=400, detail="Please upload at least one file.")

    for file in printFiles:
        await validate_upload_file(file)

    files_data = []
    total_page_count = 0

    try:
        for printFile in printFiles:
            unique_name = safe_upload_name(printFile.filename or "upload")
            storage_path = UPLOADS_DIR / unique_name
            with storage_path.open("wb") as f:
                shutil.copyfileobj(printFile.file, f)
            page_count = get_page_count(storage_path, printFile.content_type, printFile.filename)
            total_page_count += page_count
            files_data.append({
                "fileName": printFile.filename or "uploaded-file",
                "storagePath": str(storage_path)
            })

        copies_value = parse_copies_value(copies)
        validate_print_type(printType)

        token_number, token_index = make_token()
        item = create_request_item(
            token_number=token_number,
            token_index=token_index,
            student_name=name,
            files_data=files_data,
            copies=copies_value,
            print_type=printType,
            payment_method=paymentMethod,
            page_count=total_page_count,
        )
        print_requests.append(item)
        print_request_lookup[item["tokenNumber"]] = item
        return JSONResponse(status_code=201, content=serialize_request(item))
    except HTTPException:
        for fd in files_data:
            cleanup_storage_path(fd["storagePath"])
        raise
    except Exception as error:
        import traceback
        traceback.print_exc()
        for fd in files_data:
            cleanup_storage_path(fd["storagePath"])
        raise HTTPException(status_code=500, detail=str(error))
    finally:
        for printFile in printFiles:
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


@app.patch("/api/requests/{token_number}/payment")
async def update_payment_status(token_number: str, request: Request):
    expire_old_requests()
    item = find_request(token_number)

    if item is None:
        raise HTTPException(status_code=404, detail="Token not found.")

    try:
        body = await request.json()
    except Exception:
        body = {}

    next_status = body.get("paymentStatus")
    if next_status in ["Paid", "Unpaid"]:
        item["paymentStatus"] = next_status
        item["updatedAt"] = now_iso()

    return serialize_request(item)


@app.delete("/api/requests/{token_number}/file")
async def delete_request_file(token_number: str):
    expire_old_requests()
    item = find_request(token_number)

    if item is None:
        raise HTTPException(status_code=404, detail="Token not found.")

    has_files = any(f.get("storagePath") for f in item.get("files", []))
    if item["fileDeleted"] or not has_files:
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

