const uploadForm = document.getElementById('uploadForm');
const fileInput = document.getElementById('fileInput');
const selectedFileLabel = document.getElementById('selectedFileLabel');
const uploadResult = document.getElementById('uploadResult');
const shareLink = document.getElementById('shareLink');
const fileMeta = document.getElementById('fileMeta');
const downloadBtn = document.getElementById('downloadBtn');
const copyLink = document.getElementById('copyLink');
const receiveInput = document.getElementById('receiveInput');
const fetchFileBtn = document.getElementById('fetchFileBtn');
const receiveResult = document.getElementById('receiveResult');
const receiveMeta = document.getElementById('receiveMeta');
const receiveDownloadLink = document.getElementById('receiveDownloadLink');
const serverStatus = document.getElementById('serverStatus');

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  selectedFileLabel.textContent = file ? file.name : 'No file selected';
});

async function checkHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    serverStatus.textContent = data.ok ? 'Online' : 'Offline';
    if (data.publicBaseUrl) {
      document.title = `SendFiles Cloud Demo • ${data.source}`;
    }
  } catch (error) {
    serverStatus.textContent = 'Offline';
  }
}

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const file = fileInput.files?.[0];
  if (!file) {
    alert('Please choose a file first.');
    return;
  }

  const formData = new FormData();
  formData.append('file', file);

  const button = uploadForm.querySelector('button');
  button.disabled = true;
  button.textContent = 'Uploading...';

  try {
    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Upload failed');
    }

    shareLink.textContent = data.shareUrl;
    fileMeta.textContent = `${data.originalName} • ${Math.round(data.size / 1024)} KB`;
    downloadBtn.href = data.downloadUrl;
    uploadResult.classList.remove('hidden');
  } catch (error) {
    alert(error.message || 'Failed to upload file.');
  } finally {
    button.disabled = false;
    button.textContent = 'Create share link';
  }
});

copyLink.addEventListener('click', async () => {
  const value = shareLink.textContent.trim();
  if (!value || value.includes('Waiting')) return;
  await navigator.clipboard.writeText(value);
  copyLink.textContent = 'Copied';
  setTimeout(() => (copyLink.textContent = 'Copy link'), 1200);
});

fetchFileBtn.addEventListener('click', async () => {
  const raw = receiveInput.value.trim();
  const id = raw.includes('/') ? raw.split('/').filter(Boolean).at(-1) : raw;

  if (!id) {
    alert('Paste a file ID or full share URL first.');
    return;
  }

  try {
    const res = await fetch(`/api/file/${id}`);
    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'File not found.');
    }

    receiveMeta.textContent = `${data.originalName} • ${Math.round(data.size / 1024)} KB`;
    receiveDownloadLink.href = data.downloadUrl;
    receiveResult.classList.remove('hidden');
  } catch (error) {
    alert(error.message || 'Unable to load file.');
  }
});

checkHealth();
