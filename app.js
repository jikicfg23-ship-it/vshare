// تسجيل Service Worker للعمل بدون إنترنت
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(() => console.log('vShare Offline Ready'))
      .catch(err => console.error('SW Error:', err));
  });
}

// عناصر الواجهة
const homeScreen = document.getElementById('home-screen');
const connectScreen = document.getElementById('connect-screen');
const transferScreen = document.getElementById('transfer-screen');
const statusBadge = document.getElementById('status-badge');

const connectTitle = document.getElementById('connect-title');
const connectInstruction = document.getElementById('connect-instruction');
const qrDisplayBox = document.getElementById('qr-display-box');
const qrCodeDiv = document.getElementById('qrcode');
const qrScannerBox = document.getElementById('qr-scanner-box');
const btnNextStep = document.getElementById('btn-next-step');

const fileInput = document.getElementById('file-input');
const filesContainer = document.getElementById('files-container');

// متغيرات WebRTC والاتصال
let peerConnection;
let dataChannel;
let html5QrCode;
let isInitiator = false;
const CHUNK_SIZE = 65536; // 64KB لأقصى سرعة نقل عبر الواي فاي

// إعداد الاتصال المحلي (بدون خوادم خارجية ليعمل أوفلاين)
function initPeerConnection() {
  peerConnection = new RTCPeerConnection({ iceServers: [] });

  peerConnection.oniceconnectionstatechange = () => {
    const state = peerConnection.iceConnectionState;
    if (state === 'connected' || state === 'completed') {
      stopScanner();
      statusBadge.textContent = 'متصل بالواي فاي';
      statusBadge.className = 'badge connected';
      showScreen(transferScreen);
    } else if (state === 'disconnected' || state === 'failed') {
      statusBadge.textContent = 'انقطع الاتصال';
      statusBadge.className = 'badge disconnected';
    }
  };

  if (isInitiator) {
    dataChannel = peerConnection.createDataChannel('vshare-channel');
    setupDataChannel(dataChannel);
  } else {
    peerConnection.ondatachannel = (event) => {
      dataChannel = event.channel;
      setupDataChannel(dataChannel);
    };
  }
}

// انتظار اكتمال جمع عناوين الشبكة المحلية (ICE Gathering)
function waitForIceGathering(pc) {
  return new Promise(resolve => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
    } else {
      const checkState = () => {
        if (pc.iceGatheringState === 'complete') {
          pc.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', checkState);
      setTimeout(resolve, 2000); // حد أقصى ثانيتين
    }
  });
}

// ضغط بيانات الربط لتصغير حجم الـ QR Code
function compressSDP(desc) {
  return JSON.stringify({ t: desc.type === 'offer' ? 'o' : 'a', s: desc.sdp });
}

function decompressSDP(str) {
  const obj = JSON.parse(str);
  return new RTCSessionDescription({
    type: obj.t === 'o' ? 'offer' : 'answer',
    sdp: obj.s
  });
}

// 1. وضع الإرسال (إنشاء غرفة)
document.getElementById('btn-create-room').addEventListener('click', async () => {
  isInitiator = true;
  showScreen(connectScreen);
  connectTitle.textContent = 'الخطوة 1: شارك الكود';
  connectInstruction.textContent = 'تأكد من فتح نقطة الاتصال (Hotspot) واتصال الهاتف الآخر بها، ثم اجعله يمسح هذا الكود:';
  
  initPeerConnection();
  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  await waitForIceGathering(peerConnection);

  const offerData = compressSDP(peerConnection.localDescription);
  renderQR(offerData);

  btnNextStep.textContent = 'تم المسح، افتح الكاميرا لمسح رد الجهاز الآخر';
  btnNextStep.classList.remove('hidden');
});

// انتقال المرسل لمسح كود الرد (Answer)
btnNextStep.addEventListener('click', () => {
  qrDisplayBox.classList.add('hidden');
  btnNextStep.classList.add('hidden');
  connectTitle.textContent = 'الخطوة 2: امسح كود التأكيد';
  connectInstruction.textContent = 'وجّه الكاميرا الآن نحو شاشة الهاتف الآخر لمسح كود التأكيد وإتمام الربط:';
  
  startScanner(async (scannedText) => {
    const answerDesc = decompressSDP(scannedText);
    await peerConnection.setRemoteDescription(answerDesc);
  });
});

// 2. وضع الاستقبال (انضمام لغرفة)
document.getElementById('btn-join-room').addEventListener('click', () => {
  isInitiator = false;
  showScreen(connectScreen);
  connectTitle.textContent = 'الخطوة 1: امسح كود المرسل';
  connectInstruction.textContent = 'اتصل بشبكة الواي فاي (Hotspot) الخاصة بالمرسل، ثم امسح الكود الظاهر على شاشته:';
  
  initPeerConnection();
  startScanner(async (scannedText) => {
    const offerDesc = decompressSDP(scannedText);
    await peerConnection.setRemoteDescription(offerDesc);
    
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    await waitForIceGathering(peerConnection);

    const answerData = compressSDP(peerConnection.localDescription);
    connectTitle.textContent = 'الخطوة 2: اعرض كود التأكيد';
    connectInstruction.textContent = 'اجعل الهاتف المرسل يمسح هذا الكود الآن لبدء النقل فوراً:';
    renderQR(answerData);
  });
});

// عرض QR Code
function renderQR(text) {
  qrCodeDiv.innerHTML = '';
  qrDisplayBox.classList.remove('hidden');
  new QRCode(qrCodeDiv, {
    text: text,
    width: 240,
    height: 240,
    correctLevel: QRCode.CorrectLevel.L
  });
}

// تشغيل الكاميرا للمسح
function startScanner(onSuccess) {
  qrScannerBox.classList.remove('hidden');
  html5QrCode = new Html5Qrcode("reader");
  html5QrCode.start(
    { facingMode: "environment" },
    { fps: 10, qrbox: { width: 220, height: 220 } },
    (decodedText) => {
      stopScanner();
      onSuccess(decodedText);
    },
    () => {}
  ).catch(err => {
    connectInstruction.textContent = 'تعذر فتح الكاميرا. تأكد من إعطاء صلاحية الكاميرا للمتصفح.';
  });
}

function stopScanner() {
  qrScannerBox.classList.add('hidden');
  if (html5QrCode && html5QrCode.isScanning) {
    html5QrCode.stop().catch(() => {});
  }
}

// التنقل بين الشاشات
function showScreen(screen) {
  [homeScreen, connectScreen, transferScreen].forEach(s => s.classList.add('hidden'));
  screen.classList.remove('hidden');
}

document.getElementById('btn-back').addEventListener('click', () => {
  stopScanner();
  if (peerConnection) peerConnection.close();
  qrDisplayBox.classList.add('hidden');
  btnNextStep.classList.add('hidden');
  showScreen(homeScreen);
});

// ==========================================
// منطق إرسال واستقبال الملفات بأقصى سرعة
// ==========================================
let incomingFileInfo = null;
let receivedBuffers = [];
let receivedBytes = 0;

function setupDataChannel(channel) {
  channel.binaryType = 'arraybuffer';

  channel.onmessage = (event) => {
    const data = event.data;

    // استقبال بيانات تعريف الملف (JSON)
    if (typeof data === 'string') {
      const msg = JSON.parse(data);
      if (msg.type === 'meta') {
        incomingFileInfo = msg;
        receivedBuffers = [];
        receivedBytes = 0;
        createProgressUI(msg.id, msg.name, 'استقبال');
      }
      return;
    }

    // استقبال أجزاء الملف (Binary ArrayBuffer)
    receivedBuffers.push(data);
    receivedBytes += data.byteLength;

    const percent = Math.round((receivedBytes / incomingFileInfo.size) * 100);
    updateProgressUI(incomingFileInfo.id, percent);

    // عند اكتمال الملف، يتم تجميعه وتحميله تلقائياً
    if (receivedBytes >= incomingFileInfo.size) {
      const blob = new Blob(receivedBuffers, { type: incomingFileInfo.mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = incomingFileInfo.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      receivedBuffers = [];
      incomingFileInfo = null;
    }
  };
}

// اختيار الملفات وإرسالها
document.getElementById('btn-select-files').addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files);
  for (const file of files) {
    await sendFile(file);
  }
  fileInput.value = '';
});

async function sendFile(file) {
  if (!dataChannel || dataChannel.readyState !== 'open') return;

  const fileId = 'file-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
  createProgressUI(fileId, file.name, 'إرسال');

  // إرسال معلومات الملف أولاً
  dataChannel.send(JSON.stringify({
    type: 'meta',
    id: fileId,
    name: file.name,
    size: file.size,
    mime: file.type || 'application/octet-stream'
  }));

  // قراءة وإرسال الملف على شكل أجزاء (Chunks)
  let offset = 0;
  while (offset < file.size) {
    // التحكم في التدفق لمنع امتلاء الذاكرة وضمان أقصى سرعة مستقرة
    if (dataChannel.bufferedAmount > CHUNK_SIZE * 16) {
      await new Promise(r => setTimeout(r, 10));
      continue;
    }

    const slice = file.slice(offset, offset + CHUNK_SIZE);
    const buffer = await slice.arrayBuffer();
    dataChannel.send(buffer);
    
    offset += buffer.byteLength;
    const percent = Math.round((offset / file.size) * 100);
    updateProgressUI(fileId, percent);
  }
}

// واجهة شريط التقدم لكل ملف
function createProgressUI(id, name, direction) {
  const item = document.createElement('div');
  item.className = 'file-item';
  item.id = id;
  item.innerHTML = `
    <div class="file-info">
      <span class="file-name">${direction === 'إرسال' ? '📤' : '📥'} ${name}</span>
      <span class="file-percent">0%</span>
    </div>
    <div class="progress-bar">
      <div class="progress-fill"></div>
    </div>
  `;
  filesContainer.prepend(item);
}

function updateProgressUI(id, percent) {
  const item = document.getElementById(id);
  if (!item) return;
  item.querySelector('.file-percent').textContent = `${percent}%`;
  item.querySelector('.progress-fill').style.width = `${percent}%`;
}
