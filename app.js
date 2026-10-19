const fileInput = document.getElementById('fileInput');
const createOfferBtn = document.getElementById('createOfferBtn');
const offerOutput = document.getElementById('offerOutput');
const answerInput = document.getElementById('answerInput');
const applyAnswerBtn = document.getElementById('applyAnswerBtn');
const sendBtn = document.getElementById('sendBtn');
const senderStatus = document.getElementById('senderStatus');
const senderProgress = document.getElementById('senderProgress');
const senderProgressBar = document.getElementById('senderProgressBar');
const senderProgressLabel = document.getElementById('senderProgressLabel');

const offerInput = document.getElementById('offerInput');
const createAnswerBtn = document.getElementById('createAnswerBtn');
const answerOutput = document.getElementById('answerOutput');
const copyAnswerBtn = document.getElementById('copyAnswerBtn');
const receiverStatus = document.getElementById('receiverStatus');
const receiverProgress = document.getElementById('receiverProgress');
const receiverProgressBar = document.getElementById('receiverProgressBar');
const receiverProgressLabel = document.getElementById('receiverProgressLabel');

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' }
];

let pc = null;
let dataChannel = null;
let pendingFile = null;
let receiverChunks = new Map();
let receiverMeta = null;
let receiveBytes = 0;

function setStatus(node, text, type = 'info') {
  node.textContent = text;
  node.classList.remove('error', 'warn');
  if (type === 'error') node.classList.add('error');
  if (type === 'warn') node.classList.add('warn');
}

function setProgress(showNode, bar, label, value) {
  showNode.style.display = 'block';
  bar.value = value;
  label.textContent = `${Math.round(value)}%`;
}

function createPeerConnection() {
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  pc.onicecandidate = (event) => {
    if (event.candidate) return;
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      setStatus(senderStatus, 'Connected. File transfer can begin.', 'info');
      setStatus(receiverStatus, 'Connected. Ready to receive file.', 'info');
    }
    if (pc.connectionState === 'failed') {
      setStatus(senderStatus, 'Connection failed. Check the offer/answer pair.', 'error');
      setStatus(receiverStatus, 'Connection failed. Check the offer/answer pair.', 'error');
    }
  };

  pc.ondatachannel = (event) => {
    attachDataChannel(event.channel);
  };

  return pc;
}

function attachDataChannel(channel) {
  dataChannel = channel;
  dataChannel.binaryType = 'arraybuffer';

  dataChannel.onopen = () => {
    setStatus(senderStatus, 'Data channel is open.', 'info');
    setStatus(receiverStatus, 'Data channel is open and ready.', 'info');
  };

  dataChannel.onerror = () => {
    setStatus(senderStatus, 'Data channel error.', 'error');
    setStatus(receiverStatus, 'Data channel error.', 'error');
  };

  dataChannel.onclose = () => {
    setStatus(senderStatus, 'Data channel closed.', 'warn');
    setStatus(receiverStatus, 'Data channel closed.', 'warn');
  };

  dataChannel.onmessage = (event) => {
    const payload = typeof event.data === 'string' ? JSON.parse(event.data) : null;
    if (payload && payload.type === 'meta') {
      receiverMeta = payload;
      receiverChunks = new Map();
      receiveBytes = 0;
      setProgress(receiverProgress, receiverProgressBar, receiverProgressLabel, 0);
      setStatus(receiverStatus, `Receiving: ${payload.name} (${formatBytes(payload.size)})`, 'info');
      return;
    }

    if (payload && payload.type === 'chunk') {
      const chunk = payload.data;
      receiverChunks.set(payload.index, new Uint8Array(chunk));
      receiveBytes += chunk.length;
      const percent = receiverMeta ? Math.min((receiveBytes / receiverMeta.size) * 100, 100) : 0;
      setProgress(receiverProgress, receiverProgressBar, receiverProgressLabel, percent);
      return;
    }

    if (payload && payload.type === 'done') {
      finalizeDownload();
      return;
    }

    if (event.data instanceof ArrayBuffer) {
      return;
    }
  };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(1)} ${sizes[i]}`;
}

async function waitForIceGatheringComplete(peer) {
  if (peer.iceGatheringState === 'complete') return;
  await new Promise((resolve) => {
    const check = () => {
      if (peer.iceGatheringState === 'complete') {
        peer.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    };
    peer.addEventListener('icegatheringstatechange', check);
  });
}

function parseJsonText(value, label) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || !parsed.sdp) {
      throw new Error('Missing SDP');
    }
    return parsed;
  } catch (error) {
    throw new Error(`${label} must be a valid JSON object with a valid SDP field.`);
  }
}

async function createSenderOffer() {
  const file = fileInput.files[0];
  if (!file) {
    setStatus(senderStatus, 'Select a file before creating the offer.', 'error');
    return;
  }

  createPeerConnection();
  dataChannel = pc.createDataChannel('file-transfer');
  attachDataChannel(dataChannel);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceGatheringComplete(pc);

  const payload = { type: 'offer', sdp: pc.localDescription.sdp };
  offerOutput.value = JSON.stringify(payload, null, 2);
  setStatus(senderStatus, 'Offer ready. Send it to the receiver.', 'info');
}

async function applySenderAnswer() {
  if (!pc) {
    setStatus(senderStatus, 'Create the offer first.', 'error');
    return;
  }

  try {
    const payload = parseJsonText(answerInput.value, 'Answer');
    if (payload.type !== 'answer') {
      throw new Error('The pasted answer is invalid.');
    }
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: payload.sdp }));
    setStatus(senderStatus, 'Answer applied. Waiting for the data channel to finish opening.', 'info');
  } catch (error) {
    setStatus(senderStatus, error.message, 'error');
  }
}

async function createReceiverAnswer() {
  const raw = offerInput.value.trim();
  if (!raw) {
    setStatus(receiverStatus, 'Paste the sender offer before creating the answer.', 'error');
    return;
  }

  try {
    const payload = parseJsonText(raw, 'Offer');
    if (payload.type !== 'offer') {
      throw new Error('The pasted offer is invalid.');
    }

    createPeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: payload.sdp }));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceGatheringComplete(pc);

    const response = { type: 'answer', sdp: pc.localDescription.sdp };
    answerOutput.value = JSON.stringify(response, null, 2);
    setStatus(receiverStatus, 'Answer ready. Send it back to the sender.', 'info');
  } catch (error) {
    setStatus(receiverStatus, error.message, 'error');
  }
}

async function copyAnswer() {
  if (!answerOutput.value.trim()) {
    setStatus(receiverStatus, 'There is no answer to copy yet.', 'warn');
    return;
  }

  try {
    await navigator.clipboard.writeText(answerOutput.value);
    setStatus(receiverStatus, 'Answer copied to the clipboard.', 'info');
  } catch (error) {
    setStatus(receiverStatus, 'Clipboard copy failed. Please copy manually.', 'warn');
  }
}

function sendJsonMessage(message) {
  if (!dataChannel || dataChannel.readyState !== 'open') {
    throw new Error('Data channel is not open yet.');
  }
  dataChannel.send(JSON.stringify(message));
}

async function sendCurrentFile() {
  const file = fileInput.files[0];
  if (!file) {
    setStatus(senderStatus, 'Choose a file first.', 'error');
    return;
  }

  if (!pc || !dataChannel || dataChannel.readyState !== 'open') {
    setStatus(senderStatus, 'Connection is not ready yet. Create an offer and apply the answer first.', 'error');
    return;
  }

  pendingFile = file;
  const chunkSize = 64 * 1024;
  const totalChunks = Math.ceil(file.size / chunkSize);
  let index = 0;
  let offset = 0;

  sendJsonMessage({ type: 'meta', name: file.name, size: file.size, mime: file.type || 'application/octet-stream' });

  const sendNext = async () => {
    if (offset >= file.size) {
      sendJsonMessage({ type: 'done' });
      setStatus(senderStatus, `File sent: ${file.name}`, 'info');
      setProgress(senderProgress, senderProgressBar, senderProgressLabel, 100);
      return;
    }

    const end = Math.min(offset + chunkSize, file.size);
    const slice = file.slice(offset, end);
    const buffer = new Uint8Array(await slice.arrayBuffer());

    sendJsonMessage({ type: 'chunk', index, data: Array.from(buffer) });
    offset = end;
    index += 1;

    const pct = (offset / file.size) * 100;
    setProgress(senderProgress, senderProgressBar, senderProgressLabel, pct);
    setStatus(senderStatus, `Sending ${file.name} (${Math.round(pct)}%)`, 'info');

    setTimeout(sendNext, 10);
  };

  setProgress(senderProgress, senderProgressBar, senderProgressLabel, 0);
  sendNext();
}

function finalizeDownload() {
  if (!receiverMeta) return;

  const chunks = Array.from(receiverChunks.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, value]) => value);

  const merged = new Uint8Array(receiverMeta.size);
  let cursor = 0;
  for (const chunk of chunks) {
    merged.set(chunk, cursor);
    cursor += chunk.length;
  }

  const blob = new Blob([merged], { type: receiverMeta.mime || 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = receiverMeta.name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);

  setProgress(receiverProgress, receiverProgressBar, receiverProgressLabel, 100);
  setStatus(receiverStatus, `Download started: ${receiverMeta.name}`, 'info');
}

createOfferBtn.addEventListener('click', createSenderOffer);
applyAnswerBtn.addEventListener('click', applySenderAnswer);
sendBtn.addEventListener('click', sendCurrentFile);
createAnswerBtn.addEventListener('click', createReceiverAnswer);
copyAnswerBtn.addEventListener('click', copyAnswer);
