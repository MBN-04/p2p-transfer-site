const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.apiBase) || window.location.origin;
const socket = io(API_BASE, { transports: ['websocket', 'polling'] });
let pc, dataChannel;
let roomCode = null;
let roomJoined = false;
let pendingFileToSend = null;

// DOM Elements
const fileInput = document.getElementById('file');
const filePlaceholder = document.querySelector('.file-placeholder');
const receiveCodeInput = document.getElementById('receiveCode');
const receiveBtn = document.getElementById('receiveBtn');
const sendBtn = document.getElementById('send');
const uploadBtn = document.getElementById('uploadBtn');
const serverCodeInput = document.getElementById('serverCode');
const serverFetchBtn = document.getElementById('serverFetchBtn');
const textInput = document.getElementById('text');
const sendTextBtn = document.getElementById('sendText');
const receivedText = document.getElementById('receivedText');
const qrCanvas = document.getElementById('qrCanvas');
const progress = document.getElementById('progress');
const statusEl = document.getElementById('status');
const shareEl = document.getElementById('share');
const fileSessionEl = document.getElementById('fileSession');

const receiveState = { meta: null, bufs: [], received: 0, pendingChunks: [] };

// Hide transfer UI until the sender clicks Send File
fileSessionEl.style.display = 'none';
statusEl.style.display = 'none';
shareEl.style.display = 'none';

// localStorage helpers for persistence across reloads
function saveRoomState(code){
  localStorage.setItem('p2p_room_code', code);
  localStorage.setItem('p2p_room_time', Date.now().toString());
}

function loadRoomState(){
  const code = localStorage.getItem('p2p_room_code');
  const time = localStorage.getItem('p2p_room_time');
  if(code && time && (Date.now() - parseInt(time)) < 30 * 60 * 1000){
    return code;
  }
  clearRoomState();
  return null;
}

function clearRoomState(){
  localStorage.removeItem('p2p_room_code');
  localStorage.removeItem('p2p_room_time');
}

function updateStatus(msg, isConnected = false){
  statusEl.innerText = msg;
  if(msg){
    statusEl.classList.add('active');
    statusEl.style.display = 'block';
  } else {
    statusEl.classList.remove('active');
    statusEl.style.display = 'none';
  }
  if(isConnected){
    sendBtn.disabled = false;
    sendTextBtn.disabled = false;
    shareEl.style.display = 'block';
  }
}

function makeCode(){
  return Math.floor(1000 + Math.random()*9000).toString();
}

function downloadFile(blob, filename){
  console.log('Attempting to download:', filename);
  try{
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 100);
    console.log('Download triggered successfully');
  } catch(e) {
    console.warn('Standard download failed, trying alternative:', e.message);
    try{
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      console.log('Opened file in new window');
    } catch(e2){
      console.error('All download methods failed:', e2.message);
      alert('File ready but download failed. File: ' + filename);
    }
  }
}

function renderQrCode(url){
  try{
    const canvas = document.getElementById('qrCanvas');
    QRCode.toCanvas(canvas, url, { width: 200, margin: 1 }, (err)=>{
      if(err) console.error('QR error:', err);
    });
  }catch(e){
    console.error('QR render failed:', e);
  }
}

function setCodeDisplay(c){
  document.getElementById('codeDisplay').innerText = c;
  try{
    const u = new URL(window.location);
    u.searchParams.set('code', c);
    history.replaceState(null, '', u.toString());
    renderQrCode(u.toString());
    shareEl.innerHTML = `<a href="${u.toString()}" target="_blank" rel="noreferrer">${u.toString()}</a>`;
  }catch(e){
    shareEl.innerText = `Code: ${c}`;
  }
}

function joinRoom(){
  if(roomJoined) return;
  if(!roomCode) return;
  roomJoined = true;
  socket.emit('join', roomCode);
}

function ensureRoom(){
  if(!roomCode){
    roomCode = makeCode();
    setCodeDisplay(roomCode);
    saveRoomState(roomCode);
  }
  fileSessionEl.style.display = 'block';
  shareEl.style.display = 'block';
  updateStatus('Waiting for peer to join...');
  sendTextBtn.disabled = false;
  joinRoom();
}

receiveBtn.onclick = ()=>{
  let value = (receiveCodeInput.value || '').trim();
  if(!value){
    return alert('Enter the transfer code or URL.');
  }
  let code = value;
  try {
    const url = new URL(value);
    code = url.searchParams.get('code') || code;
  } catch (e) {
    // not a URL, keep original value
  }
  code = code.replace(/[^0-9]/g, '');
  if(code.length !== 4){
    return alert('Please enter a valid 4-digit code or URL.');
  }
  roomCode = code;
  receiveCodeInput.value = '';
  fileSessionEl.style.display = 'block';
  shareEl.style.display = 'none';
  updateStatus('Joining code ' + code + '...');
  sendTextBtn.disabled = false;
  saveRoomState(code);
  console.log('Joining code:', code);
  joinRoom();
};

receiveCodeInput.addEventListener('keydown', (event)=>{
  if(event.key === 'Enter'){
    receiveBtn.click();
  }
});

socket.on('created', async (code) => {
  console.log('Client: Room created, code:', code, 'current roomCode:', roomCode);
  updateStatus('Waiting for peer...');
  await prepareConnection(true);
});

socket.on('joined', async (code) => {
  console.log('Client: Room joined, code:', code, 'current roomCode:', roomCode);
  updateStatus('Connecting...');
  await prepareConnection(false);
});

socket.on('full', (code) => {
  updateStatus('Room full - try another code');
  alert('This code already has 2 users. Try a different code.');
});

socket.on('signal', async (data) => {
  if(data.type === 'offer'){
    await pc.setRemoteDescription(data);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('signal', { code: roomCode, data: pc.localDescription });
  } else if(data.type === 'answer'){
    await pc.setRemoteDescription(data);
  } else if(data.candidate){
    try{ await pc.addIceCandidate(data); }catch(e){console.warn(e)}
  }
});

async function prepareConnection(initiator){
  let cfg = { iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ] };
  try {
    const res = await fetch(`${API_BASE}/config`);
    cfg = await res.json();
  } catch (e) { /* fallback to default */ }
  
  pc = new RTCPeerConnection({ iceServers: cfg.iceServers, iceCandidatePoolSize: 20 });
  pc.onicecandidate = (e)=>{ if(e.candidate) socket.emit('signal', { code: roomCode, data: e.candidate }); };

  if(initiator){
    dataChannel = pc.createDataChannel('file', { ordered: true, maxPacketLifeTime: 3000 });
    setupDataChannel();
    const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
    await pc.setLocalDescription(offer);
    socket.emit('signal', { code: roomCode, data: pc.localDescription });
  } else {
    pc.ondatachannel = (e)=>{ dataChannel = e.channel; setupDataChannel(); };
  }
  startRelayFallbackTimer();
}

function processIncomingChunk(payload, isRelay = false) {
  const currentRoomCode = String(roomCode);
  const data = isRelay ? base64ToArrayBuffer(payload.data) : payload.data;
  receiveState.bufs.push(data);
  receiveState.received += data.byteLength;
  const pct = Math.floor(receiveState.received / receiveState.meta.size * 100);
  progress.value = pct;
  document.getElementById('progressText').innerText = pct + '%';
  console.log(`File progress: ${pct}% (${receiveState.received}/${receiveState.meta.size})`);

  if (isRelay) {
    socket.emit('relay-ack', { code: roomCode, index: payload.index });
    console.log('Receiver: Emitted relay-ack for chunk', payload.index, 'with roomCode:', roomCode);
  }

  if (receiveState.received >= receiveState.meta.size){
    console.log('File transfer complete, triggering download');
    const blob = new Blob(receiveState.bufs);
    downloadFile(blob, receiveState.meta.name);
    progress.value = 100;
    document.getElementById('progressText').innerText = '100%';
    receiveState.meta = null;
    receiveState.bufs = [];
    receiveState.pendingChunks = [];
  }
}

function setupDataChannel(){
  dataChannel.binaryType = 'arraybuffer';
  dataChannel.onopen = ()=>{
    updateStatus('✓ Connected', true);
    sendBtn.disabled = false;
    sendTextBtn.disabled = false;
    if(pendingFileToSend){
      sendFileViaChannel(pendingFileToSend);
      pendingFileToSend = null;
    }
  };
  dataChannel.onclose = ()=>{
    updateStatus('✗ Disconnected');
  };
  dataChannel.onmessage = (e)=>{
    if(typeof e.data === 'string'){
      const payload = JSON.parse(e.data);
      if(payload.type === 'text'){
        showReceivedText(payload.text);
        return;
      }
      if(payload.type === 'file-meta'){
        receiveState.meta = { name: payload.name, size: payload.size };
        receiveState.bufs = [];
        receiveState.received = 0;
        progress.value = 0;
        fileSessionEl.style.display = 'block';
        console.log('Receiver: Received file-meta payload:', payload, 'current roomCode:', roomCode);
        return;
      }
      receiveState.meta = payload;
      receiveState.bufs = [];
      receiveState.received = 0;
      progress.value = 0;
    } else {
      if(!receiveState.meta){
        console.warn('Receiver (WebRTC): Received file chunk but no metadata yet, buffering');
        receiveState.pendingChunks.push({ type: 'chunk', data: e.data });
        return;
      }
      processIncomingChunk({ data: e.data });
    }
  };
}

function sendFileViaChannel(file){
  console.log('Sending file via channel:', file.name, 'size:', file.size);
  const chunk = 2 * 1024 * 1024; // 2MB chunks
  const reader = new FileReader();
  let offset = 0;
  
  dataChannel.send(JSON.stringify({type:'file-meta', name:file.name, size:file.size}));

  reader.onload = (ev)=>{
    dataChannel.send(ev.target.result);
    offset += ev.target.result.byteLength;
    progress.value = Math.floor(offset / file.size * 100);
    document.getElementById('progressText').innerText = progress.value + '%';
    if(offset < file.size) readSlice(offset);
    else {
      console.log('File transfer complete');
    }
  };
  const readSlice = (o)=>{ const slice = file.slice(o, o + chunk); reader.readAsArrayBuffer(slice); };
  readSlice(0);
}

let relayFallback = false;
const pendingAcks = new Map();

function arrayBufferToBase64(buffer){
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToArrayBuffer(base64){
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i=0;i<len;i++) bytes[i]=binary.charCodeAt(i);
  return bytes.buffer;
}

socket.on('relay-chunk', (payload) => {
  const currentRoomCode = String(roomCode);
  if (!payload) {
    console.warn('Receiver: Received empty relay chunk payload.');
    return;
  }
  if (String(payload.code) !== currentRoomCode) {
    console.warn(`Receiver: Received relay chunk for wrong room. Payload code: ${payload.code}, current roomCode: ${currentRoomCode}. Dropping payload.`);
    return;
  }
  console.log('Receiver: Received relay chunk payload:', payload, 'current roomCode:', roomCode);
  console.log('Received relay chunk:', payload.type, payload.index);
  if (payload.type === 'meta'){
    receiveState.bufs = [];
    receiveState.meta = payload.meta;
    receiveState.received = 0;
    progress.value = 0;
    fileSessionEl.style.display = 'block';
    console.log('Receiver: File meta received:', payload.meta);
    while (receiveState.pendingChunks.length > 0) {
      const chunkPayload = receiveState.pendingChunks.shift();
      processIncomingChunk(chunkPayload, true);
    }
  } else if (payload.type === 'chunk'){
    if(!receiveState.meta){
      console.warn('Receiver (Relay): Received chunk but no metadata yet, buffering');
      receiveState.pendingChunks.push(payload);
      return;
    }
    processIncomingChunk(payload, true);
  }
});

socket.on('text', (payload)=>{
  if(!payload || String(payload.code) !== String(roomCode)) return;
  showReceivedText(payload.text);
});

async function relaySend(file){
  console.log('Starting relay send for:', file.name, 'size:', file.size);
  const chunkSize = 1024*1024;
  const reader = new FileReader();
  let offset = 0;
  const total = Math.ceil(file.size / chunkSize);
  socket.emit('relay-chunk', { code: roomCode, type: 'meta', meta: { name: file.name, size: file.size, total } });
  updateStatus('Sending via relay... 0%');
  const readSlice = (o)=>{
    return new Promise((resolve, reject)=>{
      reader.onload = (e)=> resolve(e.target.result);
      reader.onerror = reject;
      const slice = file.slice(o, o + chunkSize);
      reader.readAsArrayBuffer(slice);
    });
  };
  for (let index=0; offset < file.size; index++){
    const ab = await readSlice(offset);
    const b64 = arrayBufferToBase64(ab);
    let attempts = 0;
    const maxAttempts = 8;
    const key = `${roomCode}:${index}`;
    let acked = false;
    while(attempts < maxAttempts && !acked){
      attempts++;
      console.log(`Sender: Sending chunk ${index}/${total} (attempt ${attempts}/${maxAttempts}) for roomCode: ${roomCode}`);
      socket.emit('relay-chunk', { code: roomCode, type: 'chunk', index, data: b64 });
      try {
        await new Promise((res, rej)=>{
          const timeout = setTimeout(()=>{
            pendingAcks.delete(key);
            rej(new Error(`Chunk ${index} ack timeout after ${15000}ms`));
          }, 15000);
          pendingAcks.set(key, ()=>{ clearTimeout(timeout); res(); });
        });
        acked = true;
        console.log(`Sender: Chunk ${index} acked`);
      } catch (e) {
        console.warn(`Sender: Chunk ${index} failed:`, e.message);
        if(attempts < maxAttempts) await new Promise(r => setTimeout(r, 1000));
      }
    }
    if(!acked) throw new Error(`Failed to send chunk ${index} after ${maxAttempts} retries`);
    offset += ab.byteLength;
    const pct = Math.floor(offset / file.size * 100);
    progress.value = pct;
    updateStatus(`Sending via relay... ${pct}%`);
  }
  updateStatus('✓ File sent via relay', true);
}

socket.on('relay-ack', (p)=>{
  if(!p || String(p.code) !== String(roomCode)){
    console.warn('Received ack for wrong room:', p?.code, 'expected:', roomCode);
    return;
  }
  const key = `${p.code}:${p.index}`;
  const resolver = pendingAcks.get(key);
  if(resolver) {
    resolver();
    pendingAcks.delete(key);
  }
});

function startRelayFallbackTimer(){
  setTimeout(()=>{
    if(!dataChannel || dataChannel.readyState !== 'open'){
      if(!socket.connected){
        updateStatus('✗ Socket disconnected - cannot relay');
        return;
      }
      relayFallback = true;
      updateStatus('Using server relay fallback (slower but reliable)');
      sendTextBtn.disabled = false;
      sendBtn.disabled = false;
      if(pendingFileToSend){
        relaySend(pendingFileToSend).catch(err => {
          updateStatus('Error sending file: ' + err.message);
          console.error(err);
        });
        pendingFileToSend = null;
      }
    }
  }, 3000);
}

function showReceivedText(text){
  receivedText.innerText = text || 'Received empty message.';
}

sendBtn.onclick = ()=>{
  const file = fileInput.files[0];
  if(!file) return alert('Select a file first');
  if(roomCode){
    clearRoomState();
    roomCode = null;
  }
  if(!roomCode){
    roomCode = makeCode();
  }
  setCodeDisplay(roomCode);
  saveRoomState(roomCode);
  fileSessionEl.style.display = 'block';
  shareEl.style.display = 'block';
  updateStatus('Waiting for peer to join...', false);
  sendBtn.disabled = true;
  sendTextBtn.disabled = false;
  pendingFileToSend = file;
  joinRoom();
  console.log('File send initiated, room code:', roomCode, 'file:', file.name);
};

uploadBtn.onclick = async ()=>{
  const file = fileInput.files[0];
  if(!file) return alert('Select a file first');

  const formData = new FormData();
  formData.append('file', file);

  statusEl.style.display = 'block';
  statusEl.classList.add('active');
  statusEl.innerText = 'Uploading to cloud...';
  shareEl.style.display = 'block';
  shareEl.innerHTML = 'Uploading file to the server...';

  try {
    const res = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();

    if(!res.ok) {
      throw new Error(data.error || 'Upload failed');
    }

    const downloadUrl = `${location.origin}/download/${data.id}`;
    const code = String(data.code || '');

    statusEl.innerText = `Upload complete. Share code: ${code}`;
    shareEl.innerHTML = `
      <div><strong>Code:</strong> ${code}</div>
      <div><strong>Download:</strong> <a href="${downloadUrl}" target="_blank" rel="noreferrer">${data.name}</a></div>
      <div><strong>Direct link:</strong> <a href="${downloadUrl}" target="_blank" rel="noreferrer">${downloadUrl}</a></div>
    `;
    serverCodeInput.value = code;
    fileSessionEl.style.display = 'block';
  } catch (err) {
    statusEl.innerText = err.message || 'Upload failed';
    statusEl.classList.add('active');
    shareEl.innerText = 'Upload failed. Please try again.';
    console.error('Upload error:', err);
  }
};

serverFetchBtn.onclick = async ()=>{
  const code = (serverCodeInput.value || '').trim();
  if(!code) return alert('Please enter the file code first');

  statusEl.style.display = 'block';
  statusEl.classList.add('active');
  statusEl.innerText = 'Checking code...';

  try {
    const res = await fetch(`${API_BASE}/fetch/${encodeURIComponent(code)}`);
    const data = await res.json();

    if(!res.ok) {
      throw new Error(data.error || 'Invalid code');
    }

    const link = `${API_BASE}${data.url}`;
    statusEl.innerText = `Code valid. Downloading ${data.name}`;
    shareEl.innerHTML = `
      <div><strong>Valid code:</strong> ${code}</div>
      <div><a href="${link}" target="_blank" rel="noreferrer">Download ${data.name}</a></div>
    `;
    window.open(link, '_blank');
  } catch (err) {
    statusEl.innerText = err.message || 'Invalid code';
    shareEl.innerText = 'The code is invalid or the file has expired.';
    console.error('Fetch error:', err);
  }
};

fileInput.addEventListener('change', ()=>{
  if(fileInput.files.length > 0){
    filePlaceholder.innerText = fileInput.files[0].name;
  } else {
    filePlaceholder.innerText = 'Pick a file to send, or drag it into the box.';
  }
});

sendTextBtn.onclick = ()=>{
  const text = textInput.value.trim();
  if(!text) return alert('Write something first');
  if(!roomCode || !roomJoined){
    ensureRoom();
  }
  const payload = { type:'text', text };
  if(dataChannel && dataChannel.readyState === 'open'){
    dataChannel.send(JSON.stringify(payload));
  } else {
    socket.emit('text', { code: roomCode, text });
  }
  receivedText.innerText = 'Sent: ' + text;
  textInput.value = '';
};

window.addEventListener('load', ()=>{
  try{
    const u = new URL(window.location);
    const urlCode = u.searchParams.get('code');
    if(urlCode && urlCode.length === 4){
      roomCode = urlCode;
      saveRoomState(urlCode);
      receiveCodeInput.value = urlCode;
      receiveBtn.click();
    } else {
      const savedCode = loadRoomState();
      if(savedCode){
        roomCode = savedCode;
        console.log('Restoring room from localStorage:', savedCode);
        receiveCodeInput.value = savedCode;
        receiveBtn.click();
      }
    }
  }catch(e){
    console.error('Auto-join from URL/localStorage failed:', e);
  }
});

document.getElementById('copyBtn').addEventListener('click', async ()=>{
  const code = roomCode || document.getElementById('codeDisplay').innerText;
  const shareUrl = `${location.origin}${location.pathname}?code=${encodeURIComponent(code)}`;
  try{
    await navigator.clipboard.writeText(shareUrl);
    const b = document.getElementById('copyBtn');
    const old = b.innerText;
    b.innerText = 'Copied!';
    setTimeout(()=> b.innerText = old, 1500);
  }catch(e){
    alert('Copy failed — here is the code: ' + code);
  }
});

document.getElementById('exitRoomBtn').addEventListener('click', ()=>{
  clearRoomState();
  roomCode = null;
  roomJoined = false;
  if(pc) pc.close();
  pc = null;
  dataChannel = null;
  receiveState.meta = null;
  receiveState.bufs = [];
  receiveState.received = 0;
  progress.value = 0;
  fileSessionEl.style.display = 'none';
  shareEl.style.display = 'none';
  statusEl.style.display = 'none';
  fileInput.value = '';
  filePlaceholder.innerText = 'Pick a file to send, or drag it into the box.';
  receiveCodeInput.value = '';
  textInput.value = '';
  receivedText.innerText = 'Incoming text appears here.';
  history.replaceState(null, '', location.pathname);
  console.log('Exited room and cleared state');
});

window.addEventListener('beforeunload', ()=>{
  if(roomCode && (Date.now() - parseInt(localStorage.getItem('p2p_room_time'))) > 30 * 60 * 1000){
    clearRoomState();
  }
});
