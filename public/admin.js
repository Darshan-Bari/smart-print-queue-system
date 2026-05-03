const queueBody = document.getElementById("queueBody");
const adminMessage = document.getElementById("adminMessage");
const lastUpdated = document.getElementById("lastUpdated");
const totalCount = document.getElementById("totalCount");
const waitingCount = document.getElementById("waitingCount");
const printingCount = document.getElementById("printingCount");
const readyCount = document.getElementById("readyCount");

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return entities[character];
  });
}

function setAdminMessage(message, type = "") {
  adminMessage.textContent = message;
  adminMessage.className = "form-message";

  if (type) {
    adminMessage.classList.add(type === "error" ? "is-error" : "is-success");
  }
}

function getStatusClass(status) {
  return `status-badge status-${status.toLowerCase()}`;
}

function renderPrivacy(request) {
  if (request.fileDeleted) {
    return `<span class="privacy-chip is-deleted">Deleted (${request.deletionReason || "done"})</span>`;
  }

  const expiresAt = new Date(request.expiresAt);
  return `<span class="privacy-chip">Deletes by ${expiresAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>`;
}

function createActionButton(tokenNumber, label, status, extraClass = "") {
  return `<button class="action-button ${extraClass}" data-token="${tokenNumber}" data-status="${status}" type="button">${label}</button>`;
}

function createPrintButton(request) {
  if (!request.fileUrl) {
    return `<button class="action-button is-secondary" type="button" disabled>Print Unavailable</button>`;
  }

  return `<button class="action-button is-print" data-token="${request.tokenNumber}" data-print-url="${request.fileUrl}" type="button">Print</button>`;
}

function renderFileControls(request) {
  if (!request.fileUrl) {
    return `<div class="file-links"><span class="file-note">File deleted for privacy</span></div>`;
  }

  const safeUrl = `${API_BASE_URL}${request.fileUrl}`;

  return `
    <div class="file-links">
      <a class="file-link-button" href="${safeUrl}" target="_blank" rel="noreferrer">View</a>
      <button class="file-link-button file-link-button--danger" data-delete-file="${request.tokenNumber}" type="button">Delete</button>
    </div>
  `;
}

function renderActions(request) {
  const isLocked = request.status === "Completed" || request.status === "Expired";

  if (isLocked) {
    return `
      <div class="action-stack">
        ${createPrintButton(request)}
        <button class="action-button is-secondary" type="button" disabled>No actions</button>
      </div>
    `;
  }

  return `
    <div class="action-stack">
      ${createPrintButton(request)}
      ${createActionButton(request.tokenNumber, "Mark Printing", "Printing")}
      ${createActionButton(request.tokenNumber, "Mark Ready", "Ready", "is-secondary")}
      ${createActionButton(request.tokenNumber, "Mark Completed", "Completed", "is-alert")}
    </div>
  `;
}

function renderRows(items) {
  if (!items.length) {
    queueBody.innerHTML = `<tr><td colspan="10" class="empty-state">No print requests yet.</td></tr>`;
    return;
  }

  queueBody.innerHTML = items
    .map((request) => {
      return `
        <tr>
          <td><strong>${escapeHtml(request.tokenNumber)}</strong></td>
          <td>${escapeHtml(request.studentName)}</td>
          <td>
            ${renderFileControls(request)}
          </td>
          <td><span style="font-size: 0.85rem; color: #d54f2f; font-weight: bold;">${escapeHtml(request.remark || "-")}</span></td>
          <td>${request.copies}</td>
          <td>${escapeHtml(request.printType)}</td>
          <td><strong>₹${request.totalCost}</strong></td>
          <td>
            <div style="margin-bottom: 4px;">${escapeHtml(request.paymentMethod || "Cash")}</div>
            <button class="action-button is-secondary" data-payment-token="${request.tokenNumber}" data-payment-status="${request.paymentStatus === 'Paid' ? 'Unpaid' : 'Paid'}" type="button" style="padding: 4px 8px; font-size: 0.75rem;">
              ${request.paymentStatus === 'Paid' ? 'Mark Unpaid' : 'Mark Paid'}
            </button>
            <div style="margin-top: 4px; font-size: 0.8rem; font-weight: bold; color: ${request.paymentStatus === 'Paid' ? '#08762b' : '#ff2e63'};">
              ${escapeHtml(request.paymentStatus || 'Unpaid')}
            </div>
          </td>
          <td><span class="${getStatusClass(request.status)}">${escapeHtml(request.status)}</span></td>
          <td>${renderPrivacy(request)}</td>
          <td>${renderActions(request)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderStats(stats) {
  totalCount.textContent = stats.total;
  waitingCount.textContent = stats.waiting;
  printingCount.textContent = stats.printing;
  readyCount.textContent = stats.ready;
}

async function loadQueue() {
  try {
    // Polling keeps the dashboard simple and also refreshes the student view quickly.
    const response = await apiFetch("/api/queue");
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || "Unable to load queue.");
    }

    renderRows(data.items);
    renderStats(data.stats);
    lastUpdated.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
  } catch (error) {
    setAdminMessage(error.message || "NetworkError when attempting to fetch resource", "error");
  }
}

async function updateStatus(tokenNumber, status) {
  try {
    setAdminMessage(`Updating ${tokenNumber}...`);
    const response = await apiFetch(`/api/requests/${encodeURIComponent(tokenNumber)}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || "Status update failed.");
    }

    setAdminMessage(`${tokenNumber} moved to ${data.status}.`, "success");
    await loadQueue();
  } catch (error) {
    setAdminMessage(error.message || "NetworkError when attempting to fetch resource", "error");
  }
}

async function deleteFile(tokenNumber) {
  try {
    setAdminMessage(`Deleting file for ${tokenNumber}...`);
    const response = await apiFetch(`/api/requests/${encodeURIComponent(tokenNumber)}/file`, {
      method: "DELETE"
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || "File delete failed.");
    }

    setAdminMessage(`File deleted for ${tokenNumber}.`, "success");
    await loadQueue();
  } catch (error) {
    setAdminMessage(error.message || "NetworkError when attempting to fetch resource", "error");
  }
}

async function printRequest(tokenNumber, fileUrl) {
  try {
    setAdminMessage(`Opening print preview for ${tokenNumber}...`);
    const safeUrl = `${API_BASE_URL}${fileUrl}`;
    const printWindow = window.open(safeUrl, "_blank", "noopener,noreferrer");

    if (!printWindow) {
      throw new Error("Popup blocked. Please allow popups for this site and try again.");
    }

    // Many PDF viewers allow direct print from the opened tab.
    setTimeout(() => {
      try {
        printWindow.focus();
        printWindow.print();
      } catch (_error) {
        // Ignore cross-origin print limitations and keep manual print available.
      }
    }, 500);

    setAdminMessage(`Print view opened for ${tokenNumber}.`, "success");
  } catch (error) {
    setAdminMessage(error.message || "Unable to open print preview.", "error");
  }
}

queueBody.addEventListener("click", async (event) => {
  const printButton = event.target.closest("button[data-print-url]");

  if (printButton) {
    await printRequest(printButton.dataset.token, printButton.dataset.printUrl);
    return;
  }

  const paymentBtn = event.target.closest("button[data-payment-token]");
  if (paymentBtn) {
    const token = paymentBtn.dataset.paymentToken;
    const nextStatus = paymentBtn.dataset.paymentStatus;
    try {
      setAdminMessage(`Updating payment for ${token}...`);
      await apiFetch(`/api/requests/${encodeURIComponent(token)}/payment`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentStatus: nextStatus })
      });
      setAdminMessage(`Payment updated for ${token}.`, "success");
      await loadQueue();
    } catch (error) {
      setAdminMessage(error.message || "Failed to update payment", "error");
    }
    return;
  }

  const deleteFileButton = event.target.closest("button[data-delete-file]");

  if (deleteFileButton) {
    await deleteFile(deleteFileButton.dataset.deleteFile);
    return;
  }

  const button = event.target.closest("button[data-token]");

  if (!button) {
    return;
  }

  await updateStatus(button.dataset.token, button.dataset.status);
});

loadQueue();
setInterval(loadQueue, 5000);

const showQrBtn = document.getElementById("showQrBtn");
const closeQrBtn = document.getElementById("closeQrBtn");
const qrModal = document.getElementById("qrModal");
const websiteQR = document.getElementById("websiteQR");
const websiteUrlText = document.getElementById("websiteUrlText");
let shareAppUrl = window.location.origin;

async function loadShareAppUrl() {
  try {
    const response = await apiFetch("/api/config");
    const data = await response.json().catch(() => ({}));

    if (response.ok && data.websiteUrl) {
      shareAppUrl = data.websiteUrl;
    }
  } catch (_error) {
    shareAppUrl = window.location.origin;
  }
}

if (showQrBtn) {
  showQrBtn.addEventListener("click", () => {
    const targetUrl = shareAppUrl;

    websiteQR.src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(targetUrl)}`;
    websiteUrlText.textContent = targetUrl;
    qrModal.classList.remove("hidden");
  });
}

if (closeQrBtn) {
  closeQrBtn.addEventListener("click", () => {
    qrModal.classList.add("hidden");
  });
}

if (qrModal) {
  qrModal.addEventListener("click", (e) => {
    if (e.target === qrModal) {
      qrModal.classList.add("hidden");
    }
  });
}

loadShareAppUrl();
