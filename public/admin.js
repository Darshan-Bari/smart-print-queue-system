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
  return `<button class="action-button ${extraClass}" data-token="${tokenNumber}" data-status="${status}">${label}</button>`;
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
    return `<div class="action-stack"><button class="action-button is-secondary" disabled>No actions</button></div>`;
  }

  return `
    <div class="action-stack">
      ${createActionButton(request.tokenNumber, "Mark Printing", "Printing")}
      ${createActionButton(request.tokenNumber, "Mark Ready", "Ready", "is-secondary")}
      ${createActionButton(request.tokenNumber, "Mark Completed", "Completed", "is-alert")}
    </div>
  `;
}

function renderRows(items) {
  if (!items.length) {
    queueBody.innerHTML = `<tr><td colspan="8" class="empty-state">No print requests yet.</td></tr>`;
    return;
  }

  queueBody.innerHTML = items
    .map((request) => {
      return `
        <tr>
          <td><strong>${escapeHtml(request.tokenNumber)}</strong></td>
          <td>${escapeHtml(request.studentName)}</td>
          <td>
            <div><strong>${escapeHtml(request.fileName)}</strong></div>
            ${renderFileControls(request)}
          </td>
          <td>${request.copies}</td>
          <td>${escapeHtml(request.printType)}</td>
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

queueBody.addEventListener("click", async (event) => {
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
