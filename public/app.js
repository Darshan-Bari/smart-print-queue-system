const uploadForm = document.getElementById("uploadForm");
const formMessage = document.getElementById("formMessage");
const submitButton = document.getElementById("submitButton");
const fileInput = document.querySelector('input[name="printFiles"]');
const copiesInput = document.getElementById("copiesInput");
const printTypeInput = document.getElementById("printTypeInput");
const estimatedCostDisplay = document.getElementById("estimatedCostDisplay");
const upiQR = document.getElementById("upiQR");
const upiLink = document.getElementById("upiLink");

let filePageCount = 1;

async function extractPageCount(file) {
  if (!file) return 1;
  const name = file.name.toLowerCase();

  try {
    if (name.endsWith(".pdf") || file.type === "application/pdf") {
      const pdfjs = window.pdfjsLib || globalThis.pdfjsLib;
      if (!pdfjs) {
        console.error("pdfjsLib is not defined. Falling back to 1 page.");
        return 1;
      }
      if (!pdfjs.GlobalWorkerOptions.workerSrc) {
        pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
      }
      
      const arrayBuffer = await file.arrayBuffer();
      const typedArray = new Uint8Array(arrayBuffer);
      const loadingTask = pdfjs.getDocument({ data: typedArray });
      const pdf = await loadingTask.promise;
      return pdf.numPages || 1;
    } else if (name.endsWith(".pptx") || file.type.includes("presentation")) {
      const JSZipLib = window.JSZip || JSZip;
      if (!JSZipLib) {
        console.error("JSZip is not defined. Falling back to 1 page.");
        return 1;
      }
      
      const arrayBuffer = await file.arrayBuffer();
      const zip = await JSZipLib.loadAsync(arrayBuffer);
      if (zip.file("docProps/app.xml")) {
        const appXml = await zip.file("docProps/app.xml").async("string");
        const match = appXml.match(/<(?:[^:]+:)?Slides>(\d+)<\/(?:[^:]+:)?Slides>/i);
        if (match && match[1]) {
          return parseInt(match[1], 10);
        }
      }
      return 1;
    }
  } catch (err) {
    console.error("Failed to extract page count for " + name + ":", err);
  }
  return 1;
}

if (fileInput) {
  fileInput.addEventListener("change", async (e) => {
    const files = e.target.files;
    if (estimatedCostDisplay) estimatedCostDisplay.textContent = "Calculating pages...";
    let totalCount = 0;
    for (let i = 0; i < files.length; i++) {
        totalCount += await extractPageCount(files[i]);
    }
    filePageCount = totalCount || 1;
    updateCost();
  });
}

function updateCost() {
  if (!copiesInput || !printTypeInput) return;
  const copies = parseInt(copiesInput.value) || 1;
  const isColor = printTypeInput.value === "Color";
  const cost = filePageCount * copies * (isColor ? 6 : 2);
  
  if (estimatedCostDisplay) {
    estimatedCostDisplay.textContent = `Estimated Cost: ₹${cost} (${filePageCount} ${filePageCount === 1 ? 'page' : 'pages'})`;
  }
  
  const upiUrl = `upi://pay?pa=${window.SHOP_UPI_ID}&pn=PrintShop&am=${cost}&cu=INR`;
  if (upiQR) upiQR.src = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(upiUrl)}`;
  if (upiLink) upiLink.href = upiUrl;
}

if (copiesInput) copiesInput.addEventListener("input", updateCost);
if (printTypeInput) printTypeInput.addEventListener("change", updateCost);

// Initialize on load
updateCost();

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
    const formData = new FormData(uploadForm);

    const response = await apiFetch("/api/requests", {
      method: "POST",
      body: formData
    });

    const contentType = response.headers.get("content-type");

    let data = {};

    if (contentType && contentType.includes("application/json")) {
      data = await response.json();
    } else {
      const text = await response.text();
      console.error("Server returned non-JSON:", text);
      throw new Error("Server error. Please try again.");
    }

    if (!response.ok) {
      throw new Error(data.message || "Unable to create print request.");
    }

    if (!data.tokenNumber) {
      throw new Error("Invalid response from server.");
    }

    window.location.href = `/status.html?token=${encodeURIComponent(data.tokenNumber)}&created=1`;

  } catch (error) {
    setFormMessage(error.message || "Network error. Please try again.", "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Generate Token";
  }
});