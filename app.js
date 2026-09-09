// app.js - Full-Mesh WebRTC & Çoklu Kullanıcı Mantığı
const EXPECTED_HASH = "8ba7b049d5257dc6be31f744654eb6518779b7ae5f9d1469e3344d930f73b22b";

const authOverlay = document.getElementById('authOverlay');
const usernameInput = document.getElementById('usernameInput');
const pinInput = document.getElementById('pinInput');
const btnUnlock = document.getElementById('btnUnlock');
const authError = document.getElementById('authError');
const currentUserTag = document.getElementById('currentUserTag');

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const statusBadge = document.getElementById('statusBadge');
const userCountSpan = document.getElementById('userCountSpan');
const dropdownUsersList = document.getElementById('dropdownUsersList');

const videoElement = document.getElementById('sharedVideo');
const placeholder = document.getElementById('placeholder');
const remoteAudiosContainer = document.getElementById('remoteAudiosContainer');
const cameraGrid = document.getElementById('cameraGrid');

const btnUnmute = document.getElementById('btnUnmute');
const btnMic = document.getElementById('btnMic');
const btnCam = document.getElementById('btnCam');
const btnShareScreen = document.getElementById('btnShareScreen');
const btnDisconnect = document.getElementById('btnDisconnect');

const chatInput = document.getElementById('chatInput');
const chatList = document.getElementById('chatList');
const btnToggleChat = document.getElementById('btnToggleChat');
const chatSidebar = document.getElementById('chatSidebar');

let peer = null;
let myName = '';
let myPeerId = '';
let peers = {}; // Bağlı diğer kullanıcılar { peerId: { name, conn } }

let micStream = null;
let camStream = null;
let screenStream = null;
let isMicMuted = true;
let isCamOff = true;

// SHA-256 Şifre Hashleme
async function sha256(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Avatar Renk Üreteci
function getAvatarColor(str) {
  const colors = ['#5865f2', '#eb459e', '#57f287', '#fee75c', '#ed4245', '#9b59b6'];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

// Katılımcı Listesi Dropdown Toggle
statusBadge.addEventListener('click', (e) => {
  e.stopPropagation();
  statusBadge.classList.toggle('open');
});
document.addEventListener('click', () => {
  statusBadge.classList.remove('open');
});

// Sohbet Paneli Toggle
btnToggleChat.addEventListener('click', () => {
  chatSidebar.classList.toggle('open');
});

// Şifre Giriş Doğrulaması
async function login() {
  const username = usernameInput.value.trim();
  const enteredPass = pinInput.value.trim();

  if (!username) {
    alert('Lütfen bir kullanıcı adı belirleyin!');
    return;
  }

  try {
    const inputHash = await sha256(enteredPass);
    if (inputHash !== EXPECTED_HASH) {
      authError.style.display = 'block';
      pinInput.value = '';
      return;
    }

    authError.style.display = 'none';
    myName = username;
    currentUserTag.innerText = `Sen: ${myName}`;
    authOverlay.style.display = 'none';

    initRoom(inputHash.substring(0, 16));
  } catch (err) {
    console.error("Şifreleme hatası:", err);
    alert("Tarayıcı güvenlik motoru çalıştırılamadı.");
  }
}

btnUnlock.addEventListener('click', login);
pinInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') login();
});

// PeerJS ve Full-Mesh Ağ Kurulumu
function initRoom(roomHash) {
  // Benzersiz rastgele ID yerine sabit hash tabanlı ID ile herkesin birbirini bulması sağlanır
  myPeerId = `wt-${roomHash}-${Math.floor(Math.random() * 100000)}`;

  peer = new Peer(myPeerId, {
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    }
  });

  peer.on('open', (id) => {
    statusDot.classList.add('connected');
    statusText.innerText = `Oda: 1`;
    appendMessage('Sistem', `Hoş geldin ${myName}! Odaya bağlandın.`, 'sys');
    updateRoomUsers();
  });

  // Gelen Çağrılar (Ses, Kamera veya Ekran)
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

  // Gelen Veri/Chat Kanalları
  peer.on('connection', (conn) => {
    setupConnection(conn);
  });

  // Otomatik olarak odadaki diğer olası katılımcıyı arama denemesi (Discovery simülasyonu)
  // Pratik test için aynı hash prefix'e sahip olası ID'leri tetikleyebiliriz ya da peer bağlantısı kurabiliriz.
}

// Bağlantı Kurulumu ve El Sıkışma (Handshake)
function setupConnection(conn) {
  conn.on('open', () => {
    peers[conn.peer] = { name: 'Katılımcı', conn: conn };
    updateRoomUsers();

    conn.send({ type: 'handshake', name: myName });

    // Mevcut akışlarımızı yeni gelen kişiye gönder
    if (micStream) peer.call(conn.peer, micStream, { metadata: { type: 'audio' } });
    if (camStream) peer.call(conn.peer, camStream, { metadata: { type: 'camera', senderName: myName } });
    if (screenStream) peer.call(conn.peer, screenStream, { metadata: { type: 'screen' } });
  });

  conn.on('data', (data) => {
    if (typeof data !== 'object') return;

    if (data.type === 'handshake') {
      peers[conn.peer] = { name: data.name, conn: conn };
      updateRoomUsers();
      appendMessage('Sistem', `${data.name} odaya katıldı! 🎉`, 'sys');
      conn.send({ type: 'handshake-ack', name: myName });
    } else if (data.type === 'handshake-ack') {
      peers[conn.peer] = { name: data.name, conn: conn };
      updateRoomUsers();
    } else if (data.type === 'msg') {
      appendMessage(data.sender, data.text, 'remote');
    } else if (data.type === 'screen-stopped') {
      resetVideoArea();
    } else if (data.type === 'cam-stopped') {
      removeCameraBox(conn.peer);
    }
  });

  conn.on('close', () => {
    const leaving = peers[conn.peer]?.name || 'Biri';
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

function updateRoomUsers() {
  const totalUsers = Object.keys(peers).length + 1;
  statusText.innerText = `Oda: ${totalUsers}`;
  userCountSpan.innerText = totalUsers;

  dropdownUsersList.innerHTML = `
    <div class="dropdown-user-item">
      <div class="dropdown-user-dot"></div>
      <span>${myName} (Sen)</span>
    </div>
  `;

  Object.values(peers).forEach(p => {
    dropdownUsersList.innerHTML += `
      <div class="dropdown-user-item">
        <div class="dropdown-user-dot"></div>
        <span>${p.name}</span>
      </div>
    `;
  });
}

// Mikrofon Kontrolü
btnMic.addEventListener('click', async () => {
  if (!micStream) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      isMicMuted = false;
      btnMic.classList.add('active');
      btnMic.innerHTML = '<i class="fa-solid fa-microphone"></i>';

      // Odadakilere ses çağrısı at
      Object.keys(peers).forEach(peerId => {
        peer.call(peerId, micStream, { metadata: { type: 'audio' } });
      });
    } catch (e) {
      alert('Mikrofon izni reddedildi!');
    }
  } else {
    isMicMuted = !isMicMuted;
    micStream.getAudioTracks().forEach(t => t.enabled = !isMicMuted);
    btnMic.classList.toggle('active', !isMicMuted);
    btnMic.innerHTML = isMicMuted ? '<i class="fa-solid fa-microphone-slash"></i>' : '<i class="fa-solid fa-microphone"></i>';
  }
});

// Kamera Kontrolü
btnCam.addEventListener('click', async () => {
  if (camStream) {
    stopCamera();
    return;
  }

  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    renderCameraBox('local', myName, camStream);

    isCamOff = false;
    btnCam.classList.add('active');
    btnCam.innerHTML = '<i class="fa-solid fa-video"></i>';

    Object.keys(peers).forEach(peerId => {
      peer.call(peerId, camStream, { metadata: { type: 'camera', senderName: myName } });
    });
  } catch (e) {
    alert('Kamera açılamadı!');
  }
});

function stopCamera() {
  if (camStream) {
    camStream.getTracks().forEach(t => t.stop());
    camStream = null;
  }
  removeCameraBox('local');
  isCamOff = true;
  btnCam.classList.remove('active');
  btnCam.innerHTML = '<i class="fa-solid fa-video-slash"></i>';
  broadcastData({ type: 'cam-stopped' });
}

function renderCameraBox(id, name, stream) {
  let box = document.getElementById(`cam-${id}`);
  if (!box) {
    box = document.createElement('div');
    box.id = `cam-${id}`;
    box.className = 'cam-box';
    box.innerHTML = `
      <video autoplay playsinline ${id === 'local' ? 'muted' : ''}></video>
      <span class="cam-user-tag">${name}</span>
    `;
    cameraGrid.appendChild(box);
  }
  box.querySelector('video').srcObject = stream;
}

function removeCameraBox(id) {
  const box = document.getElementById(`cam-${id}`);
  if (box) box.remove();
}

// Ekran Paylaşımı
btnShareScreen.addEventListener('click', async () => {
  if (screenStream) {
    stopScreenSharing();
    return;
  }

  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { cursor: 'always' },
      audio: true
    });

    attachVideoStream(screenStream);
    btnShareScreen.classList.add('active');

    Object.keys(peers).forEach(peerId => {
      peer.call(peerId, screenStream, { metadata: { type: 'screen' } });
    });

    screenStream.getVideoTracks()[0].onended = () => {
      stopScreenSharing();
    };
  } catch (err) {
    console.log("Ekran paylaşımı iptal edildi.");
  }
});

function stopScreenSharing() {
  resetVideoArea();
  btnShareScreen.classList.remove('active');
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  broadcastData({ type: 'screen-stopped' });
}

function attachVideoStream(stream) {
  videoElement.srcObject = stream;
  videoElement.style.display = 'block';
  placeholder.style.display = 'none';

  const playPromise = videoElement.play();
  if (playPromise !== undefined) {
    playPromise.catch(() => {
      videoElement.muted = true;
      videoElement.play();
      btnUnmute.style.display = 'block';
    });
  }
}

btnUnmute.addEventListener('click', () => {
  videoElement.muted = false;
  btnUnmute.style.display = 'none';
});

function resetVideoArea() {
  videoElement.style.display = 'none';
  placeholder.style.display = 'flex';
  videoElement.srcObject = null;
}

function attachAudioStream(peerId, stream) {
  let audio = document.getElementById(`audio-${peerId}`);
  if (!audio) {
    audio = document.createElement('audio');
    audio.id = `audio-${peerId}`;
    audio.autoplay = true;
    remoteAudiosContainer.appendChild(audio);
  }
  audio.srcObject = stream;
}

function removeAudioStream(peerId) {
  const audio = document.getElementById(`audio-${peerId}`);
  if (audio) audio.remove();
}

function attachCameraStream(peerId, name, stream) {
  renderCameraBox(peerId, name, stream);
}

// Sohbet Mesajlaşma
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && chatInput.value.trim() !== '') {
    const text = chatInput.value.trim();
    appendMessage(myName, text, 'me');
    broadcastData({ type: 'msg', sender: myName, text: text });
    chatInput.value = '';
  }
});

function appendMessage(sender, text, type) {
  const msg = document.createElement('div');
  msg.className = 'discord-msg';

  const avatar = document.createElement('div');
  avatar.className = `msg-avatar ${type === 'sys' ? 'sys' : ''}`;
  avatar.style.backgroundColor = getAvatarColor(sender);
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

// Oturumu Kapat / Çıkış
btnDisconnect.addEventListener('click', () => {
  if (peer) peer.destroy();
  window.location.reload();
});
