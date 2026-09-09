const EXPECTED_HASH = "4631f037cd1158e98cf9499d8bd978d3d91c2d7580b1edf993ad9aff31d7b1e9";

const authOverlay = document.getElementById('authOverlay');
const usernameInput = document.getElementById('usernameInput');
const pinInput = document.getElementById('pinInput');
const btnUnlock = document.getElementById('btnUnlock');
const authError = document.getElementById('authError');
const currentUserTag = document.getElementById('currentUserTag');

const statusBadge = document.getElementById('statusBadge');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const userCountSpan = document.getElementById('userCountSpan');
const dropdownUsersList = document.getElementById('dropdownUsersList');

const videoElement = document.getElementById('sharedVideo');
const placeholder = document.getElementById('placeholder');
const btnUnmute = document.getElementById('btnUnmute');
const btnFullscreen = document.getElementById('btnFullscreen');
const btnShareScreen = document.getElementById('btnShareScreen');
const btnMic = document.getElementById('btnMic');
const btnCam = document.getElementById('btnCam');
const btnDisconnect = document.getElementById('btnDisconnect');
const chatInput = document.getElementById('chatInput');
const chatList = document.getElementById('chatList');
const btnToggleChat = document.getElementById('btnToggleChat');
const btnCloseChat = document.getElementById('btnCloseChat');
const chatSidebar = document.getElementById('chatSidebar');
const cameraGrid = document.getElementById('cameraGrid');
const remoteAudiosContainer = document.getElementById('remoteAudiosContainer');
const typingIndicator = document.getElementById('typingIndicator');
const typingUser = document.getElementById('typingUser');

const screenVolumeControl = document.getElementById('screenVolumeControl');
const screenVolSlider = document.getElementById('screenVolSlider');
const screenVolText = document.getElementById('screenVolText');

const btnReactionTrigger = document.getElementById('btnReactionTrigger');
const reactionMenu = document.getElementById('reactionMenu');
const reactionsLayer = document.getElementById('reactionsLayer');

let screenStream = null;
let micStream = null;
let camStream = null;
let peer = null;

let myName = '';
let myPeerId = '';
let roomPrefix = '';
let typingTimeout = null;

// Web Audio API & Gain Nodes (Sesi %200'e yükseltebilmek için)
let audioCtx = null;
let screenGainNode = null;
let screenAudioSource = null;

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

const peers = {}; // { name, conn, gainNode, volume }
const MAX_SLOTS = 10;

async function sha256(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Kişiye Özel Renkler (Aleyna Pembe/Mor tonu, Diğerleri Yeşil/Neon)
function getAvatarColor(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('aleyna')) return 'linear-gradient(135deg, #eb459e, #c77dff)';
  return 'linear-gradient(135deg, #23a55a, #8a2be2)';
}

// Menü ve Reaksiyon Aç/Kapa
statusBadge.addEventListener('click', (e) => {
  if (e.target.closest('.user-list-dropdown') || e.target.closest('input')) return;
  e.stopPropagation();
  statusBadge.classList.toggle('open');
});

btnReactionTrigger.addEventListener('click', (e) => {
  e.stopPropagation();
  reactionMenu.classList.toggle('open');
});

document.addEventListener('click', () => {
  statusBadge.classList.remove('open');
  reactionMenu.classList.remove('open');
});

// Reaksiyon Gönderme
document.querySelectorAll('.react-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const emoji = btn.dataset.emoji;
    spawnEmoji(emoji);
    broadcastData({ type: 'reaction', emoji: emoji });
    reactionMenu.classList.remove('open');
  });
});

function spawnEmoji(emoji) {
  const el = document.createElement('div');
  el.className = 'floating-emoji';
  el.innerText = emoji;
  el.style.left = `${Math.random() * 70 + 15}%`;
  reactionsLayer.appendChild(el);
  setTimeout(() => el.remove(), 2400);
}

// Katılımcı Listesi ve Bağımsız Ses Ayarı (%0 - %200)
function updateRoomUsers() {
  if (!dropdownUsersList) return;
  dropdownUsersList.innerHTML = '';
  
  const otherUsers = Object.entries(peers);
  const totalUsers = 1 + otherUsers.length;

  statusText.innerText = totalUsers > 1 ? `Bağlı (${totalUsers})` : 'Yalnızsın';
  userCountSpan.innerText = `${totalUsers}`;

  if (totalUsers > 1) {
    statusDot.classList.add('connected');
  } else {
    statusDot.classList.remove('connected');
  }

  // 1. Sen
  const myItem = document.createElement('div');
  myItem.className = 'dropdown-user-item';
  myItem.innerHTML = `
    <div class="dropdown-user-avatar" style="background: ${getAvatarColor(myName)}">
      ${(myName || 'S').charAt(0).toUpperCase()}
    </div>
    <span style="font-weight: 700; color: #fff;">${myName}</span>
    <span class="dropdown-user-tag" style="color: var(--neon-purple-bright); font-weight: 700; margin-left:auto;">(Sen)</span>
  `;
  dropdownUsersList.appendChild(myItem);

  // 2. Diğer Katılımcılar
  otherUsers.forEach(([peerId, p]) => {
    const currentVol = p.volume !== undefined ? p.volume : 1;
    const userItem = document.createElement('div');
    userItem.className = 'dropdown-user-item';
    userItem.innerHTML = `
      <div class="dropdown-user-avatar" style="background: ${getAvatarColor(p.name)}">
        ${p.name.charAt(0).toUpperCase()}
      </div>
      <div style="display:flex; flex-direction:column; gap:1px;">
        <span style="color: #fff; font-weight:600;">${p.name}</span>
        <span class="dropdown-user-tag" style="color: var(--neon-green-bright); font-size:10px;">● Çevrimiçi</span>
      </div>
      <div class="user-vol-wrapper">
        <i class="fa-solid fa-volume-low" style="font-size:11px; color:var(--text-muted);"></i>
        <input type="range" class="user-vol-slider" min="0" max="2" step="0.05" value="${currentVol}" data-peer="${peerId}" />
        <span class="user-vol-val" id="vol-val-${peerId}">%${Math.round(currentVol * 100)}</span>
      </div>
    `;

    const slider = userItem.querySelector('.user-vol-slider');
    slider.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      p.volume = val;
      if (p.gainNode) {
        p.gainNode.gain.setValueAtTime(val, getAudioContext().currentTime);
      }
      const label = document.getElementById(`vol-val-${peerId}`);
      if (label) label.innerText = `%${Math.round(val * 100)}`;
    });

    dropdownUsersList.appendChild(userItem);
  });
}

// Ekran Ses Ayarı (%0 - %200)
screenVolSlider.addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  if (screenGainNode) {
    screenGainNode.gain.setValueAtTime(val, getAudioContext().currentTime);
  }
  screenVolText.innerText = `%${Math.round(val * 100)}`;
});

btnToggleChat.addEventListener('click', () => chatSidebar.classList.toggle('open'));
btnCloseChat.addEventListener('click', () => chatSidebar.classList.remove('open'));

// Otomatik Giriş Kontrolü
window.addEventListener('DOMContentLoaded', () => {
  const savedUser = localStorage.getItem('wt_username');
  const savedPass = localStorage.getItem('wt_password');
  if (savedUser && savedPass) {
    usernameInput.value = savedUser;
    pinInput.value = savedPass;
    login(true);
  }
});

async function login(isAuto = false) {
  const username = usernameInput.value.trim();
  const enteredPass = pinInput.value.trim();

  if (!username) {
    alert('Lütfen kullanıcı adını gir!');
    return;
  }

  try {
    const inputHash = await sha256(enteredPass);
    if (inputHash !== EXPECTED_HASH) {
      authError.style.display = 'block';
      pinInput.value = '';
      if (isAuto) {
        localStorage.removeItem('wt_username');
        localStorage.removeItem('wt_password');
        authOverlay.style.display = 'flex';
      }
      return;
    }

    localStorage.setItem('wt_username', username);
    localStorage.setItem('wt_password', enteredPass);

    authError.style.display = 'none';
    myName = username;
    currentUserTag.innerText = `Sen: ${myName}`;
    authOverlay.style.display = 'none';

    updateRoomUsers();
    joinMeshRoom(inputHash.substring(0, 16));
  } catch (err) {
    console.error(err);
  }
}

btnUnlock.addEventListener('click', () => login(false));
pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') login(false); });

// Mesh Bağlantı
function joinMeshRoom(hash) {
  roomPrefix = `wt-${hash}`;
  tryJoinSlot(0);
}

function tryJoinSlot(slotIndex) {
  if (slotIndex >= MAX_SLOTS) {
    alert("Oda şu an tamamen dolu!");
    return;
  }

  const candidateId = `${roomPrefix}-slot${slotIndex}`;
  const tempPeer = new Peer(candidateId, {
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    }
  });

  tempPeer.on('open', (id) => {
    peer = tempPeer;
    myPeerId = id;
    appendMessage('Sistem', `VIP Odasına Hoş Geldin ${myName}! ✨`, 'sys');
    setupMeshListeners();
    connectToOtherSlots(slotIndex);
  });

  tempPeer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      tempPeer.destroy();
      tryJoinSlot(slotIndex + 1);
    }
  });
}

function connectToOtherSlots(mySlot) {
  for (let i = 0; i < MAX_SLOTS; i++) {
    if (i !== mySlot) {
      const targetId = `${roomPrefix}-slot${i}`;
      const conn = peer.connect(targetId, { metadata: { name: myName } });
      setupConnection(conn);
    }
  }
}

function setupMeshListeners() {
  peer.on('connection', (conn) => setupConnection(conn));

  peer.on('call', (call) => {
    const meta = call.metadata || {};
    if (meta.type === 'screen') {
      call.answer();
      call.on('stream', (stream) => attachVideoStream(stream));
    } else if (meta.type === 'audio') {
      call.answer(micStream || undefined);
      call.on('stream', (stream) => attachAudioStream(call.peer, stream));
    } else if (meta.type === 'camera') {
      call.answer(camStream || undefined);
      call.on('stream', (stream) => attachCameraStream(call.peer, meta.senderName || 'Katılımcı', stream));
    }
  });
}

function setupConnection(conn) {
  conn.on('open', () => {
    const initialName = conn.metadata?.name || 'Katılımcı';
    if (!peers[conn.peer]) {
      peers[conn.peer] = { name: initialName, conn: conn, volume: 1, gainNode: null };
    }
    updateRoomUsers();
    conn.send({ type: 'handshake', name: myName });

    if (micStream) peer.call(conn.peer, micStream, { metadata: { type: 'audio' } });
    if (camStream) peer.call(conn.peer, camStream, { metadata: { type: 'camera', senderName: myName } });
    if (screenStream) peer.call(conn.peer, screenStream, { metadata: { type: 'screen' } });
  });

  conn.on('data', (data) => {
    if (typeof data !== 'object') return;

    if (data.type === 'handshake') {
      const isNew = !peers[conn.peer] || peers[conn.peer].name !== data.name;
      peers[conn.peer] = peers[conn.peer] || { volume: 1, gainNode: null };
      peers[conn.peer].name = data.name;
      peers[conn.peer].conn = conn;
      updateRoomUsers();
      
      if (isNew) {
        appendMessage('Sistem', `${data.name} odaya katıldı! 🎉`, 'sys');
        conn.send({ type: 'handshake-ack', name: myName });
      }
    } else if (data.type === 'handshake-ack') {
      peers[conn.peer] = peers[conn.peer] || { volume: 1, gainNode: null };
      peers[conn.peer].name = data.name;
      peers[conn.peer].conn = conn;
      updateRoomUsers();
    } else if (data.type === 'msg') {
      appendMessage(data.sender, data.text, 'remote');
    } else if (data.type === 'typing') {
      showTyping(data.sender);
    } else if (data.type === 'reaction') {
      spawnEmoji(data.emoji);
    } else if (data.type === 'screen-stopped') {
      resetVideoArea();
    } else if (data.type === 'cam-stopped') {
      removeCameraBox(conn.peer);
    }
  });

  conn.on('close', () => {
    const leaving = peers[conn.peer]?.name || 'Katılımcı';
    appendMessage('Sistem', `${leaving} odadan ayrıldı.`, 'sys');
    removeCameraBox(conn.peer);
    removeAudioStream(conn.peer);
    delete peers[conn.peer];
    updateRoomUsers();
  });
}

function broadcastData(obj) {
  Object.values(peers).forEach(p => {
    if (p.conn && p.conn.open) p.conn.send(obj);
  });
}

function broadcastCall(stream, type) {
  Object.keys(peers).forEach(peerId => {
    peer.call(peerId, stream, { metadata: { type: type, senderName: myName } });
  });
}

// Ses Yükseltici & Dinamik Gain Node
function attachAudioStream(peerId, stream) {
  let audio = document.getElementById(`audio-${peerId}`);
  if (!audio) {
    audio = document.createElement('audio');
    audio.id = `audio-${peerId}`;
    audio.autoplay = true;
    remoteAudiosContainer.appendChild(audio);
  }
  audio.srcObject = stream;

  try {
    const ctx = getAudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const gainNode = ctx.createGain();

    const currentVol = peers[peerId]?.volume !== undefined ? peers[peerId].volume : 1;
    gainNode.gain.setValueAtTime(currentVol, ctx.currentTime);

    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    if (!peers[peerId]) peers[peerId] = { name: 'Katılımcı', volume: 1 };
    peers[peerId].gainNode = gainNode;
    audio.muted = true;
  } catch (err) {
    audio.muted = false;
  }
}

function removeAudioStream(peerId) {
  const a = document.getElementById(`audio-${peerId}`);
  if (a) a.remove();
}

// Mikrofon
btnMic.addEventListener('click', async () => {
  if (!micStream) {
    try {
      getAudioContext();
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      btnMic.classList.add('active');
      btnMic.classList.remove('muted');
      btnMic.innerHTML = '<i class="fa-solid fa-microphone"></i>';
      broadcastCall(micStream, 'audio');
    } catch (err) {
      alert('Mikrofon izni alınamadı!');
    }
  } else {
    const track = micStream.getAudioTracks()[0];
    if (track) {
      track.enabled = !track.enabled;
      btnMic.classList.toggle('active', track.enabled);
      btnMic.classList.toggle('muted', !track.enabled);
      btnMic.innerHTML = track.enabled ? '<i class="fa-solid fa-microphone"></i>' : '<i class="fa-solid fa-microphone-slash"></i>';
    }
  }
});

// Ekran Paylaşımı
btnShareScreen.addEventListener('click', async () => {
  if (screenStream) {
    stopSharing();
    return;
  }

  try {
    getAudioContext();
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always' },
      audio: true
    });

    attachVideoStream(screenStream);
    btnShareScreen.classList.add('active');
    broadcastCall(screenStream, 'screen');
    screenStream.getVideoTracks()[0].onended = () => stopSharing();
  } catch (err) {}
});

function stopSharing() {
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  broadcastData({ type: 'screen-stopped' });
  resetVideoArea();
}

function resetVideoArea() {
  videoElement.srcObject = null;
  videoElement.style.display = 'none';
  placeholder.style.display = 'flex';
  btnShareScreen.classList.remove('active');
  btnUnmute.style.display = 'none';
  btnFullscreen.style.display = 'none';
  if (screenVolumeControl) screenVolumeControl.style.display = 'none';
}

function attachVideoStream(stream) {
  videoElement.srcObject = stream;
  videoElement.style.display = 'block';
  placeholder.style.display = 'none';
  btnFullscreen.style.display = 'flex';
  if (screenVolumeControl) screenVolumeControl.style.display = 'flex';

  try {
    if (stream.getAudioTracks().length > 0) {
      const ctx = getAudioContext();
      if (screenAudioSource) screenAudioSource.disconnect();
      screenAudioSource = ctx.createMediaStreamSource(stream);
      screenGainNode = ctx.createGain();
      screenGainNode.gain.setValueAtTime(parseFloat(screenVolSlider.value || 1), ctx.currentTime);
      screenAudioSource.connect(screenGainNode);
      screenGainNode.connect(ctx.destination);
      videoElement.muted = true;
    }
  } catch (e) {
    videoElement.muted = false;
  }

  const playPromise = videoElement.play();
  if (playPromise !== undefined) {
    playPromise.catch(() => {
      videoElement.muted = true;
      videoElement.play();
      btnUnmute.style.display = 'flex';
    });
  }
}

btnUnmute.addEventListener('click', () => {
  getAudioContext();
  videoElement.muted = false;
  btnUnmute.style.display = 'none';
});

// Tam Ekran Butonu
btnFullscreen.addEventListener('click', () => {
  const container = document.getElementById('screenArea');
  if (!document.fullscreenElement) {
    if (container.requestFullscreen) container.requestFullscreen();
    else if (container.webkitRequestFullscreen) container.webkitRequestFullscreen();
  } else {
    if (document.exitFullscreen) document.exitFullscreen();
  }
});

// Kamera Yönetimi
btnCam.addEventListener('click', async () => {
  if (camStream) {
    stopCamera();
    return;
  }

  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    renderCamBox('local', myName, camStream, true);
    btnCam.classList.add('active');
    btnCam.innerHTML = '<i class="fa-solid fa-video"></i>';
    broadcastCall(camStream, 'camera');
  } catch (err) {
    alert('Kamera açılamadı!');
  }
});

function stopCamera() {
  if (camStream) {
    camStream.getTracks().forEach(t => t.stop());
    camStream = null;
  }
  removeCameraBox('local');
  btnCam.classList.remove('active');
  btnCam.innerHTML = '<i class="fa-solid fa-video-slash"></i>';
  broadcastData({ type: 'cam-stopped' });
}

function attachCameraStream(peerId, name, stream) {
  renderCamBox(peerId, name, stream, false);
}

function renderCamBox(id, name, stream, isLocal) {
  let box = document.getElementById(`cam-${id}`);
  if (!box) {
    box = document.createElement('div');
    box.id = `cam-${id}`;
    box.className = `cam-box ${isLocal ? 'local' : ''}`;

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    if (isLocal) video.muted = true;
    video.srcObject = stream;

    const tag = document.createElement('span');
    tag.className = 'cam-user-tag';
    tag.innerText = isLocal ? `${name} (Sen)` : name;

    box.appendChild(video);
    box.appendChild(tag);
    cameraGrid.appendChild(box);
  } else {
    const video = box.querySelector('video');
    if (video) video.srcObject = stream;
  }
}

function removeCameraBox(id) {
  const box = document.getElementById(`cam-${id}`);
  if (box) box.remove();
}

// Sohbet & Yazıyor Göstergesi
chatInput.addEventListener('input', () => {
  broadcastData({ type: 'typing', sender: myName });
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && chatInput.value.trim() !== '') {
    const text = chatInput.value.trim();
    appendMessage(myName, text, 'me');
    broadcastData({ type: 'msg', sender: myName, text: text });
    chatInput.value = '';
  }
});

function showTyping(sender) {
  typingUser.innerText = sender;
  typingIndicator.style.display = 'block';
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    typingIndicator.style.display = 'none';
  }, 2000);
}

function appendMessage(sender, text, type) {
  const msg = document.createElement('div');
  msg.className = 'discord-msg';

  const avatar = document.createElement('div');
  avatar.className = `msg-avatar ${type === 'sys' ? 'sys' : ''}`;
  avatar.style.background = getAvatarColor(sender);
  avatar.innerText = sender.charAt(0).toUpperCase();

  const body = document.createElement('div');
  body.className = 'msg-body';

  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  body.innerHTML = `
    <div class="msg-author-line">
      <span class="msg-author">${sender}</span>
      <span class="msg-time">${timeStr}</span>
    </div>
    <div class="msg-text">${text}</div>
  `;

  msg.appendChild(avatar);
  msg.appendChild(body);
  chatList.appendChild(msg);
  chatList.scrollTop = chatList.scrollHeight;
}

// Çıkış
btnDisconnect.addEventListener('click', () => {
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  stopCamera();
  stopSharing();

  Object.values(peers).forEach(p => { if (p.conn) p.conn.close(); });
  if (peer) { peer.destroy(); peer = null; }

  localStorage.removeItem('wt_username');
  localStorage.removeItem('wt_password');
  authOverlay.style.display = 'flex';
});
