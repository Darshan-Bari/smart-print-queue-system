

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_LIFETIME_MS = 30 * 60 * 1000;
const STATUS = {
  WAITING: "Waiting",
  PRINTING: "Printing",
  READY: "Ready",
  COMPLETED: "Completed",
  EXPIRED: "Expired"
};
const ACTIVE_QUEUE_STATUSES = [STATUS.WAITING, STATUS.PRINTING];

const uploadsDir = path.join(__dirname, "uploads");
const publicDir = path.join(__dirname, "public");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

let nextTokenNumber = 1;
// In-memory queue keeps the prototype simple and easy to demo locally.
const requests = [];

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safeOriginalName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeOriginalName}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const isPdf = file.mimetype === "application/pdf";
    const isImage = file.mimetype.startsWith("image/");

    if (isPdf || isImage) {
      cb(null, true);
      return;
    }

    cb(new Error("Only PDF and image files are allowed."));
  }
});

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
  allowedHeaders: ["Content-Type"]
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req, res) => {
  res.send("Backend is running");
});

app.use(express.static(publicDir));

function createTokenNumber() {
  const token = `T-${String(nextTokenNumber).padStart(3, "0")}`;
  nextTokenNumber += 1;
  return token;
}

function calculateJobMinutes(printRequest) {
  const baseMinutes = printRequest.printType === "Color" ? 4 : 3;
  const copyMinutes = Math.max(printRequest.copies - 1, 0) * 0.5;
  return Math.ceil(baseMinutes + copyMinutes);
}

function getActiveQueue() {
  return requests
    .filter((request) => ACTIVE_QUEUE_STATUSES.includes(request.status))
    .sort((a, b) => a.tokenIndex - b.tokenIndex);
}

function getQueuePosition(printRequest) {
  if (printRequest.status === STATUS.READY) {
    return 0;
  }

  if (!ACTIVE_QUEUE_STATUSES.includes(printRequest.status)) {
    return 0;
  }

  const activeQueue = getActiveQueue();
  const position = activeQueue.findIndex((item) => item.tokenNumber === printRequest.tokenNumber);
  return position === -1 ? 0 : position + 1;
}

function getEstimatedWaitTimeMinutes(printRequest) {
  if (printRequest.status === STATUS.READY || printRequest.status === STATUS.COMPLETED) {
    return 0;
  }

  if (printRequest.status === STATUS.EXPIRED) {
    return 0;
  }

  const activeQueue = getActiveQueue();
  const currentIndex = activeQueue.findIndex((item) => item.tokenNumber === printRequest.tokenNumber);

  if (currentIndex === -1) {
    return 0;
  }

  const jobsAhead = activeQueue.slice(0, currentIndex);
  const waitFromQueue = jobsAhead.reduce((total, item) => total + calculateJobMinutes(item), 0);

  if (printRequest.status === STATUS.PRINTING) {
    return Math.max(1, Math.ceil(calculateJobMinutes(printRequest) / 2));
  }

  return waitFromQueue + calculateJobMinutes(printRequest);
}

async function deleteStoredFile(printRequest, reason) {
  if (printRequest.fileDeleted || !printRequest.storagePath) {
    return;
  }

  try {
    await fsp.unlink(printRequest.storagePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error(`Failed to delete file for ${printRequest.tokenNumber}:`, error);
    }
  }

  printRequest.fileDeleted = true;
  printRequest.deletedAt = new Date().toISOString();
  printRequest.deletionReason = reason;
  printRequest.storagePath = null;
}

function buildQueueStats() {
  return {
    total: requests.length,
    waiting: requests.filter((item) => item.status === STATUS.WAITING).length,
    printing: requests.filter((item) => item.status === STATUS.PRINTING).length,
    ready: requests.filter((item) => item.status === STATUS.READY).length,
    completed: requests.filter((item) => item.status === STATUS.COMPLETED).length,
    expired: requests.filter((item) => item.status === STATUS.EXPIRED).length
  };
}

function serializeRequest(printRequest) {
  return {
    tokenNumber: printRequest.tokenNumber,
    tokenIndex: printRequest.tokenIndex,
    studentName: printRequest.studentName,
    fileName: printRequest.fileName,
    copies: printRequest.copies,
    printType: printRequest.printType,
    status: printRequest.status,
    createdAt: printRequest.createdAt,
    updatedAt: printRequest.updatedAt,
    expiresAt: printRequest.expiresAt,
    queuePosition: getQueuePosition(printRequest),
    estimatedWaitTimeMinutes: getEstimatedWaitTimeMinutes(printRequest),
    fileDeleted: printRequest.fileDeleted,
    deletionReason: printRequest.deletionReason || null,
    privacyMessage: "Your file will be automatically deleted after printing for privacy."
  };
}

function findRequest(tokenNumber) {
  return requests.find((item) => item.tokenNumber === tokenNumber.toUpperCase());
}

async function expireOldRequests() {
  const now = Date.now();

  for (const printRequest of requests) {
    if (printRequest.fileDeleted) {
      continue;
    }

    const isExpired = now >= new Date(printRequest.expiresAt).getTime();
    const canExpire = ![STATUS.COMPLETED, STATUS.EXPIRED].includes(printRequest.status);

    if (isExpired && canExpire) {
      printRequest.status = STATUS.EXPIRED;
      printRequest.updatedAt = new Date().toISOString();
      await deleteStoredFile(printRequest, "expired");
    }
  }
}

// Run a lightweight cleanup loop so expired uploads never stay on disk for long.
setInterval(() => {
  expireOldRequests().catch((error) => {
    console.error("Automatic expiry check failed:", error);
  });
}, 60 * 1000);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, uptimeSeconds: Math.round(process.uptime()) });
});

app.post("/api/requests", upload.single("printFile"), async (req, res) => {
  try {
    console.log("Request received");
    await expireOldRequests();

    if (!req.file) {
      res.status(400).json({ message: "Please upload a PDF or image file." });
      return;
    }

    const copies = Number.parseInt(req.body.copies, 10);
    const printType = req.body.printType;

    if (!Number.isInteger(copies) || copies < 1 || copies > 100) {
      await fsp.unlink(req.file.path).catch(() => {});
      res.status(400).json({ message: "Copies must be a number between 1 and 100." });
      return;
    }

    if (!["Black & White", "Color"].includes(printType)) {
      await fsp.unlink(req.file.path).catch(() => {});
      res.status(400).json({ message: "Please select a valid print type." });
      return;
    }

    const createdAt = new Date();
    const printRequest = {
      tokenNumber: createTokenNumber(),
      tokenIndex: nextTokenNumber - 1,
      studentName: (req.body.name || "").trim() || "Anonymous Student",
      fileName: req.file.originalname,
      storagePath: req.file.path,
      copies,
      printType,
      status: STATUS.WAITING,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + UPLOAD_LIFETIME_MS).toISOString(),
      fileDeleted: false
    };

    requests.push(printRequest);
    res.status(201).json(serializeRequest(printRequest));
  } catch (error) {
    console.error("Failed to create request:", error);
    res.status(500).json({ message: "Could not create the print request." });
  }
});

app.get("/api/requests/:tokenNumber", async (req, res) => {
  await expireOldRequests();

  const printRequest = findRequest(req.params.tokenNumber);

  if (!printRequest) {
    res.status(404).json({ message: "Token not found." });
    return;
  }

  res.json(serializeRequest(printRequest));
});

app.get("/api/queue", async (_req, res) => {
  await expireOldRequests();

  const sortedRequests = [...requests].sort((a, b) => {
    if (a.status === STATUS.COMPLETED && b.status !== STATUS.COMPLETED) {
      return 1;
    }

    if (a.status !== STATUS.COMPLETED && b.status === STATUS.COMPLETED) {
      return -1;
    }

    return a.tokenIndex - b.tokenIndex;
  });

  res.json({
    items: sortedRequests.map(serializeRequest),
    stats: buildQueueStats()
  });
});

app.patch("/api/requests/:tokenNumber/status", async (req, res) => {
  await expireOldRequests();

  const printRequest = findRequest(req.params.tokenNumber);

  if (!printRequest) {
    res.status(404).json({ message: "Token not found." });
    return;
  }

  if (printRequest.status === STATUS.EXPIRED) {
    res.status(400).json({ message: "Expired requests cannot be updated." });
    return;
  }

  const nextStatus = req.body.status;
  const allowedStatuses = [STATUS.WAITING, STATUS.PRINTING, STATUS.READY, STATUS.COMPLETED];

  if (!allowedStatuses.includes(nextStatus)) {
    res.status(400).json({ message: "Invalid status." });
    return;
  }

  printRequest.status = nextStatus;
  printRequest.updatedAt = new Date().toISOString();

  if (nextStatus === STATUS.COMPLETED) {
    await deleteStoredFile(printRequest, "completed");
  }

  res.json(serializeRequest(printRequest));
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    res.status(400).json({ message: error.message });
    return;
  }

  if (error.message === "Only PDF and image files are allowed.") {
    res.status(400).json({ message: error.message });
    return;
  }

  console.error("Unhandled server error:", error);
  res.status(500).json({ message: "Something went wrong." });
});

app.listen(PORT, () => {
  console.log(`Smart Print Queue is running at http://localhost:${PORT}`);
});
