const uploadForm = document.getElementById("uploadForm");
const formMessage = document.getElementById("formMessage");
const submitButton = document.getElementById("submitButton");

function setFormMessage(message, type = "") {
  formMessage.textContent = message;
  formMessage.className = "form-message";

  if (type) {
    formMessage.classList.add(type === "error" ? "is-error" : "is-success");
  }
}

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setFormMessage("");
  submitButton.disabled = true;
  submitButton.textContent = "Generating...";

  try {
    // Send the file and form details together so the server can create the queue entry.
    const formData = new FormData(uploadForm);
    const response = await fetch("https://smart-print-queue-system.onrender.com/api/requests", {
      method: "POST",
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || "Unable to create print request.");
    }

    window.location.href = `/status.html?token=${encodeURIComponent(data.tokenNumber)}&created=1`;
  } catch (error) {
    setFormMessage(error.message, "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Generate Token";
  }
});
