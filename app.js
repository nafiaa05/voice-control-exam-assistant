// ═══════════════════════════════════════════════════════
//  VoiceExam v3 — Persistent Mic, Fixed Options, Clean Flow
// ═══════════════════════════════════════════════════════

let currentUser = null;
let currentTest = null;
let currentQ = 0;
let answers = {};
let tabWarnings = 0;
let camWarnings = 0;
let examInterval = null;
let timeLeft = 0;
let camStream = null;
let camCheckInterval = null;
let autoSubmitted = false;
let voiceLog = [];

// ─── SESSION MIC: always-on during exam ──────────────
let sessionMicActive = false;   // user toggled ON/OFF
let recognition = null;
let recognitionRunning = false; // actual recognition.start() state

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function initRecognition() {
  if (!SpeechRecognition) return;
  recognition = new SpeechRecognition();
  recognition.continuous = true;       // keep running — no per-question toggle
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (e) => {
    if (!sessionMicActive) return;
    let interim = '', final = '';
    for (let r of e.results) {
      if (r.isFinal) final += r[0].transcript;
      else interim += r[0].transcript;
    }
    const heard = final || interim;
    const el = document.getElementById('transcript-text');
    if (el) el.textContent = heard || '—';

    if (final && document.getElementById('page-exam').classList.contains('active')) {
      processVoiceInput(final.trim());
    }
  };

  recognition.onend = () => {
    recognitionRunning = false;
    // Auto-restart if session mic is still ON and exam is active
    if (sessionMicActive && document.getElementById('page-exam').classList.contains('active')) {
      setTimeout(() => startRecognitionEngine(), 200);
    }
  };

  recognition.onerror = (e) => {
    recognitionRunning = false;
    if (e.error === 'not-allowed') {
      addVoiceLog('error', 'Microphone permission denied');
      sessionMicActive = false;
      updateMicUI();
      return;
    }
    // Restart on other errors if session mic is on
    if (sessionMicActive && document.getElementById('page-exam').classList.contains('active')) {
      setTimeout(() => startRecognitionEngine(), 500);
    }
  };
}

function startRecognitionEngine() {
  if (!recognition || recognitionRunning) return;
  try { recognition.start(); recognitionRunning = true; } catch (e) {}
}

function stopRecognitionEngine() {
  if (!recognition) return;
  try { recognition.stop(); } catch (e) {}
  recognitionRunning = false;
}

// User-facing session mic toggle (one button for the whole exam session)
function toggleSessionMic() {
  if (!SpeechRecognition) {
    alert('Web Speech API not supported. Please use Google Chrome.');
    return;
  }
  sessionMicActive = !sessionMicActive;
  if (sessionMicActive) {
    startRecognitionEngine();
    addVoiceLog('info', 'Microphone activated for session');
  } else {
    stopRecognitionEngine();
    addVoiceLog('info', 'Microphone deactivated');
  }
  updateMicUI();
}

function updateMicUI() {
  const btn = document.getElementById('mic-session-btn');
  const icon = document.getElementById('mic-s-icon');
  const label = document.getElementById('mic-s-label');
  const vs = document.getElementById('voice-status');
  const vsText = document.getElementById('vs-text');
  if (!btn) return;
  if (sessionMicActive) {
    btn.classList.add('active');
    if (icon) icon.textContent = '🔴';
    if (label) label.textContent = 'Stop Listening';
    if (vs) vs.className = 'voice-status listening';
    if (vsText) vsText.textContent = 'Listening — speak a command';
  } else {
    btn.classList.remove('active');
    if (icon) icon.textContent = '🎙️';
    if (label) label.textContent = 'Start Listening';
    if (vs) vs.className = 'voice-status idle';
    if (vsText) vsText.textContent = 'Mic is off — click to activate';
  }
}

// ─── Voice Commands ───────────────────────────────────
const COMMANDS = {
  next:      ['next', 'next question', 'go next', 'move next'],
  previous:  ['previous', 'previous question', 'go back', 'go previous', 'back', 'prev'],
  repeat:    ['repeat', 'repeat question', 'read again', 'read question', 'say again'],
  checktime: ['check time', 'time left', 'how much time', 'time remaining', 'remaining time'],
  submit:    ['submit', 'submit exam', 'finish exam', 'end exam', 'submit test'],
  optA:      ['option a', 'answer a'],
  optB:      ['option b', 'answer b'],
  optC:      ['option c', 'answer c'],
  optD:      ['option d', 'answer d'],
};

function matchCommand(text) {
  const t = text.toLowerCase().trim();
  for (const [cmd, phrases] of Object.entries(COMMANDS)) {
    if (phrases.some(p => t === p || t.includes(p))) return cmd;
  }
  // Single-letter fallback only for exactly "a", "b", "c", "d"
  if (t === 'a') return 'optA';
  if (t === 'b') return 'optB';
  if (t === 'c') return 'optC';
  if (t === 'd') return 'optD';
  return null;
}

function processVoiceInput(text) {
  const cmd = matchCommand(text);
  if (cmd) {
    handleVoiceCommand(cmd, text);
  } else {
    selectOptionByVoice(text);
  }
}

function handleVoiceCommand(cmd, raw) {
  addVoiceLog('command', raw);
  switch (cmd) {
    case 'next':     nextQ(); speak('Next question.'); break;
    case 'previous': prevQ(); speak('Previous question.'); break;
    case 'repeat':   readQuestion(); break;
    case 'checktime': {
      const m = Math.floor(timeLeft / 60), s = timeLeft % 60;
      speak(`${m} minutes and ${s} seconds remaining.`);
      addVoiceLog('info', `Time: ${m}m ${s}s left`);
      break;
    }
    case 'submit':
      speak('Submitting your exam now.');
      setTimeout(() => submitExam(false), 1500);
      break;
    case 'optA': selectOptionByLetter(0, raw); break;
    case 'optB': selectOptionByLetter(1, raw); break;
    case 'optC': selectOptionByLetter(2, raw); break;
    case 'optD': selectOptionByLetter(3, raw); break;
  }
}

function selectOptionByLetter(idx, raw) {
  if (!currentTest) return;
  const q = currentTest.questions[currentQ];
  if (!q || !q.options || q.options[idx] === undefined) return;
  selectOption(q.options[idx]);
  speak(`Selected option ${['A', 'B', 'C', 'D'][idx]}: ${q.options[idx]}`);
  addVoiceLog('answer', `"${raw}" → Option ${['A', 'B', 'C', 'D'][idx]}: ${q.options[idx]}`);
}

function selectOptionByVoice(text) {
  if (!currentTest) return;
  const q = currentTest.questions[currentQ];
  if (!q || !q.options) return;
  const t = text.toLowerCase();
  const matched = q.options.find(o => {
    const ol = o.toLowerCase();
    return ol.includes(t) || t.includes(ol);
  });
  if (matched) {
    selectOption(matched);
    speak(`Selected: ${matched}`);
    addVoiceLog('answer', `"${text}" → ${matched}`);
  } else {
    addVoiceLog('unrecognized', `"${text}" — no match`);
    speak('Not recognized. Say option A, B, C, or D.');
  }
}

function selectOption(optText) {
  answers[currentQ] = optText;
  renderOptionHighlight();
  renderProgressDots();
}

// ─── TTS ─────────────────────────────────────────────
function speak(text) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.93; u.pitch = 1;
  window.speechSynthesis.speak(u);
}

function readQuestion() {
  if (!currentTest) return;
  const q = currentTest.questions[currentQ];
  const labels = ['A', 'B', 'C', 'D'];
  let txt = `Question ${currentQ + 1}. ${q.question}. `;
  if (q.options && q.options.length) {
    txt += 'Options: ' + q.options.map((o, i) => `${labels[i]}: ${o}`).join('. ') + '.';
  }
  speak(txt);
  addVoiceLog('tts', `Read Q${currentQ + 1}`);
}

// ─── Voice Log ───────────────────────────────────────
function addVoiceLog(type, msg) {
  const now = new Date().toLocaleTimeString();
  voiceLog.unshift({ q: currentQ + 1, type, msg, time: now });
  if (voiceLog.length > 50) voiceLog.pop();
  renderVoiceLog();
}

function renderVoiceLog() {
  const el = document.getElementById('voice-log-list');
  if (!el) return;
  const icons = { command: '⚡', answer: '✅', unrecognized: '❓', tts: '🔊', info: 'ℹ️', error: '❌' };
  el.innerHTML = voiceLog.slice(0, 20).map(entry => `
    <div class="vl-item vl-${entry.type}">
      <span class="vl-icon">${icons[entry.type] || '•'}</span>
      <div class="vl-body"><span class="vl-q">Q${entry.q}</span><span class="vl-msg">${entry.msg}</span></div>
      <span class="vl-time">${entry.time}</span>
    </div>`).join('') || '<div class="vl-empty">No activity yet</div>';
}

// ─── Page Navigation ─────────────────────────────────
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
}

// ─── Auth ────────────────────────────────────────────
function switchTab(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('tab-login').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('tab-register').style.display = tab === 'register' ? 'block' : 'none';
}

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-err');
  errEl.textContent = '';
  try {
    const r = await fetch('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const d = await r.json();
    if (d.ok) {
      currentUser = d;
      if (d.role === 'admin') { showPage('admin'); loadAdminDashboard(); }
      else {
        document.getElementById('student-name-nav').textContent = d.name;
        showPage('student');
        loadStudentTests();
      }
    } else errEl.textContent = d.msg || 'Login failed';
  } catch { errEl.textContent = 'Server error. Is the backend running?'; }
}

async function doRegister() {
  const name = document.getElementById('reg-name').value.trim();
  const regNo = document.getElementById('reg-regno').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const errEl = document.getElementById('reg-err');
  errEl.textContent = '';
  if (!name || !email || !password) { errEl.textContent = 'All fields required'; return; }
  if (password.length < 6) { errEl.textContent = 'Password minimum 6 characters'; return; }
  const r = await fetch('/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, regNo, email, password })
  });
  const d = await r.json();
  if (d.ok) {
    document.getElementById('reg-err').style.color = 'var(--success)';
    errEl.textContent = '✓ Registered! Please sign in.';
    document.querySelectorAll('.tab-btn')[0].click();
  } else errEl.textContent = d.msg || 'Registration failed';
}

function logout() {
  currentUser = null; currentTest = null;
  stopExam();
  showPage('login');
}

// ─── Student ──────────────────────────────────────────
function studentView(v, btn) {
  document.querySelectorAll('#page-student .dash-view').forEach(d => d.classList.remove('active'));
  document.getElementById('sv-' + v).classList.add('active');
  document.querySelectorAll('#page-student .nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (v === 'results') loadStudentResults();
}

async function loadStudentTests() {
  const r = await fetch('/api/tests?studentId=' + currentUser.id);
  const tests = await r.json();
  const el = document.getElementById('test-cards');
  if (!tests.length) { el.innerHTML = '<p style="color:var(--text2)">No tests available yet.</p>'; return; }
  el.innerHTML = tests.map(t => {
    const maxA = t.maxAttempts || 2;
    const used = t.attemptCount || 0;
    const remaining = maxA - used;
    const pct = Math.round((used / maxA) * 100);
    const disabled = remaining <= 0;
    const best = t.bestScore != null ? `Best: ${t.bestScore}/${t.questions?.length || '?'}` : 'Not attempted';
    return `
    <div class="test-card">
      <div class="card-subject">${t.subject}</div>
      <div class="card-desc">${t.description || 'No description provided'}</div>
      <div class="card-meta">
        <span class="card-tag green">⏱ ${t.duration}min</span>
        <span class="card-tag purple">📝 ${t.questions?.length || 0} Qs</span>
        <span class="card-tag">🔁 ${remaining} attempt${remaining !== 1 ? 's' : ''} left</span>
      </div>
      <div class="attempts-bar"><div class="attempts-fill" style="width:${pct}%"></div></div>
      <div style="font-size:.72rem;color:var(--text3);margin-bottom:.8rem">${best}</div>
      <button class="btn-start" onclick="startExam('${t.id}')" ${disabled ? 'disabled' : ''}>
        ${disabled ? '✗ No Attempts Left' : '🎙️ Start Exam'}
      </button>
    </div>`;
  }).join('');
}

async function loadStudentResults() {
  const r = await fetch('/api/attempts?studentId=' + currentUser.id);
  const attempts = await r.json();
  const el = document.getElementById('result-cards');
  if (!attempts.length) { el.innerHTML = '<p style="color:var(--text2)">No results yet. Take a test first!</p>'; return; }
  el.innerHTML = attempts.map(a => {
    const pass = a.percent >= 50;
    return `
    <div class="result-card-small">
      <div class="rc-subject">${a.subject || a.testSubject || 'Unknown'}</div>
      <div class="rc-score">${a.score}/${a.total}</div>
      <div style="color:${pass ? 'var(--success)' : 'var(--danger)'};font-size:.82rem;font-weight:600;margin-bottom:.4rem">
        ${a.percent}% — ${pass ? 'PASS' : 'FAIL'}
      </div>
      <div class="rc-date">${new Date(a.submittedAt).toLocaleDateString()}</div>
      ${a.autoSubmitted ? '<div style="font-size:.7rem;color:var(--warn);margin-top:.3rem">⚠️ Auto-submitted</div>' : ''}
    </div>`;
  }).join('');
}

// ─── Start Exam ───────────────────────────────────────
async function startExam(testId) {
  const r = await fetch('/api/tests/' + testId);
  const test = await r.json();

  // ── FIX: ensure options always exist ──
  if (test.questions) {
    test.questions = test.questions.map(q => ({
      ...q,
      options: Array.isArray(q.options) ? q.options.filter(o => o && o.trim() !== '') : []
    }));
  }

  currentTest = test;
  currentQ = 0;
  answers = {};
  tabWarnings = 0;
  camWarnings = 0;
  autoSubmitted = false;
  voiceLog = [];
  sessionMicActive = false;

  // Reset mic UI
  updateMicUI();
  const tw = document.getElementById('tab-warn-count');
  const cw = document.getElementById('cam-warn-count');
  if (tw) tw.textContent = '0';
  if (cw) cw.textContent = '0';

  showPage('exam');
  document.getElementById('exam-subject-title').textContent = test.subject;
  document.getElementById('q-total').textContent = test.questions.length;
  document.getElementById('exam-meta').innerHTML = `
    <div><b>Subject:</b> ${test.subject}</div>
    <div><b>Questions:</b> ${test.questions.length}</div>
    <div><b>Duration:</b> ${test.duration} minutes</div>`;

  initRecognition();
  renderQuestion();
  startTimer(test.duration * 60);
  startCamera();
  setupTabDetection();
  renderVoiceLog();

  speak(`Welcome to the ${test.subject} exam. You have ${test.duration} minutes. Click Start Listening to activate voice control. Question 1 will now be read.`);
  setTimeout(readQuestion, 3500);
}

// ─── Render Question ──────────────────────────────────
function renderQuestion() {
  if (!currentTest) return;
  const q = currentTest.questions[currentQ];
  const labels = ['A', 'B', 'C', 'D'];

  document.getElementById('q-current').textContent = currentQ + 1;
  document.getElementById('qn-num').textContent = currentQ + 1;
  document.getElementById('q-text').textContent = q.question;

  const tEl = document.getElementById('transcript-text');
  if (tEl) tEl.textContent = '—';

  const btnPrev = document.getElementById('btn-prev');
  const btnNext = document.getElementById('btn-next');
  if (btnPrev) btnPrev.disabled = currentQ === 0;
  if (btnNext) btnNext.disabled = currentQ === currentTest.questions.length - 1;

  // ── Render MCQ Options ──
  const optsEl = document.getElementById('exam-options');
  if (!optsEl) return;

  const opts = q.options || [];
  if (opts.length === 0) {
    optsEl.innerHTML = '<p style="color:var(--text2);font-size:.85rem;padding:.5rem">No options defined for this question.</p>';
  } else {
    optsEl.innerHTML = opts.map((opt, i) => `
      <button class="exam-opt ${answers[currentQ] === opt ? 'selected' : ''}"
              onclick="manualSelectOption(${currentQ}, '${opt.replace(/'/g, "\\'")}')">
        <span class="opt-label">${labels[i] || (i + 1)}</span>
        <span class="opt-text">${opt}</span>
      </button>`).join('');
  }

  renderProgressDots();
}

function renderOptionHighlight() {
  if (!currentTest) return;
  const q = currentTest.questions[currentQ];
  const opts = q.options || [];
  document.querySelectorAll('#exam-options .exam-opt').forEach((btn, i) => {
    btn.classList.toggle('selected', answers[currentQ] === opts[i]);
  });
}

function renderProgressDots() {
  const el = document.getElementById('q-dots');
  if (!el || !currentTest) return;
  el.innerHTML = currentTest.questions.map((_, i) => {
    let cls = 'qdot';
    if (i === currentQ) cls += ' current';
    else if (answers[i] !== undefined) cls += ' answered';
    return `<span class="${cls}" onclick="jumpToQ(${i})" title="Q${i + 1}">${i + 1}</span>`;
  }).join('');
}

function jumpToQ(idx) { currentQ = idx; renderQuestion(); }

function manualSelectOption(qIdx, opt) {
  if (qIdx !== currentQ) return;
  selectOption(opt);
  addVoiceLog('answer', `Click → ${opt}`);
}

function nextQ() {
  if (!currentTest) return;
  if (currentQ < currentTest.questions.length - 1) { currentQ++; renderQuestion(); }
}
function prevQ() {
  if (currentQ > 0) { currentQ--; renderQuestion(); }
}

// ─── Timer ───────────────────────────────────────────
function startTimer(seconds) {
  clearInterval(examInterval);
  timeLeft = seconds;
  updateTimerDisplay();
  examInterval = setInterval(() => {
    timeLeft--;
    updateTimerDisplay();
    if (timeLeft <= 0) { clearInterval(examInterval); submitExam(true); }
    if (timeLeft <= 120) document.getElementById('exam-timer').classList.add('urgent');
    if (timeLeft === 300) speak('5 minutes remaining.');
    if (timeLeft === 60) speak('1 minute remaining.');
  }, 1000);
}

function updateTimerDisplay() {
  const el = document.getElementById('exam-timer');
  if (!el) return;
  const m = Math.floor(timeLeft / 60).toString().padStart(2, '0');
  const s = (timeLeft % 60).toString().padStart(2, '0');
  el.textContent = `${m}:${s}`;
}

// ─── Camera ──────────────────────────────────────────
async function startCamera() {
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    document.getElementById('cam-feed').srcObject = camStream;
    startFaceCheck();
  } catch { console.warn('Camera not accessible'); }
}

function stopCamera() {
  if (camStream) camStream.getTracks().forEach(t => t.stop());
  clearInterval(camCheckInterval);
}

function startFaceCheck() {
  const video = document.getElementById('cam-feed');
  const canvas = document.createElement('canvas');
  canvas.width = 40; canvas.height = 30;
  const ctx = canvas.getContext('2d');
  let absentFrames = 0;
  camCheckInterval = setInterval(() => {
    if (!video || !video.srcObject) return;
    try {
      ctx.drawImage(video, 0, 0, 40, 30);
      const d = ctx.getImageData(0, 0, 40, 30).data;
      let bright = 0;
      for (let i = 0; i < d.length; i += 4) bright += (d[i] + d[i + 1] + d[i + 2]) / 3;
      bright /= (d.length / 4);
      if (bright < 20 || bright > 245) absentFrames++;
      else absentFrames = Math.max(0, absentFrames - 1);
      if (absentFrames > 5) { absentFrames = 0; handleCameraWarning(); }
    } catch {}
  }, 2000);
}

function handleCameraWarning() {
  camWarnings++;
  const el = document.getElementById('cam-warn-count');
  if (el) el.textContent = camWarnings;
  const wc = document.getElementById('wc-cam');
  if (wc) wc.classList.add('active');
  if (camWarnings >= 3) {
    showWarn('Auto-Submit!', '⛔ You were not detected in the camera 3 times. Exam is being submitted automatically.');
    setTimeout(() => submitExam(true), 3000);
  } else {
    showWarn(`Camera Warning ${camWarnings}/2`,
      `Your face was not detected. Warning ${camWarnings} of 2. On the 3rd warning, the exam will be submitted automatically.`);
  }
}

// ─── Tab Detection ────────────────────────────────────
function setupTabDetection() {
  document.addEventListener('visibilitychange', onTabSwitch);
  window.addEventListener('blur', onTabSwitch);
}

function onTabSwitch() {
  if ((document.hidden || !document.hasFocus()) &&
    document.getElementById('page-exam').classList.contains('active') &&
    !autoSubmitted) {
    tabWarnings++;
    const el = document.getElementById('tab-warn-count');
    if (el) el.textContent = tabWarnings;
    const wc = document.getElementById('wc-tab');
    if (wc) wc.classList.add('active');
    addVoiceLog('info', `Tab switch detected (#${tabWarnings})`);
    if (tabWarnings >= 3) {
      showWarn('Auto-Submit!', '⛔ You switched tabs 3 times. Exam is being submitted automatically.');
      setTimeout(() => submitExam(true), 3000);
    } else {
      showWarn(`Tab Switch Warning ${tabWarnings}/2`,
        `You left the exam window. Warning ${tabWarnings} of 2. A third switch will auto-submit your exam.`);
    }
  }
}

function showWarn(title, msg) {
  document.getElementById('warn-title').textContent = title;
  document.getElementById('warn-msg').textContent = msg;
  document.getElementById('warn-overlay').style.display = 'flex';
}
function closeWarn() { document.getElementById('warn-overlay').style.display = 'none'; }

// ─── Submit ───────────────────────────────────────────
function confirmSubmit() {
  if (confirm('Are you sure you want to submit the exam?')) submitExam(false);
}

async function submitExam(auto = false) {
  if (autoSubmitted) return;
  autoSubmitted = true;
  clearInterval(examInterval);
  stopCamera();
  sessionMicActive = false;
  stopRecognitionEngine();
  window.speechSynthesis && window.speechSynthesis.cancel();
  document.removeEventListener('visibilitychange', onTabSwitch);
  window.removeEventListener('blur', onTabSwitch);

  const formatted = {};
  if (currentTest) {
    currentTest.questions.forEach((q, i) => { formatted[String(i)] = answers[i] || ''; });
  }

  const r = await fetch('/api/attempts', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      studentId: currentUser.id,
      testId: currentTest.id,
      answers: formatted,
      tabWarnings, camWarnings,
      autoSubmitted: auto
    })
  });
  const d = await r.json();
  if (!d.ok) { alert(d.msg || 'Submit failed'); return; }
  showResult(d);
}

function showResult(d) {
  showPage('result');
  const pass = d.percent >= 50;
  document.getElementById('result-emoji').textContent = pass ? '🎉' : '😔';
  document.getElementById('result-title').textContent = pass ? 'Well Done!' : 'Better Luck Next Time';
  document.getElementById('result-score').textContent = `${d.score}/${d.total}`;
  document.getElementById('result-pct').textContent = d.percent + '%';

  const circ = 2 * Math.PI * 50;
  const offset = circ - (d.percent / 100) * circ;
  setTimeout(() => { document.getElementById('score-arc').style.strokeDashoffset = offset; }, 100);
  document.getElementById('score-arc').style.stroke = pass ? 'var(--success)' : 'var(--danger)';

  document.getElementById('result-details').innerHTML = (d.details || []).map((det, i) => `
    <div class="det-item ${det.isCorrect ? 'correct' : 'wrong'}">
      <span class="det-icon">${det.isCorrect ? '✅' : '❌'}</span>
      <div>
        <div class="det-q">Q${i + 1}: ${det.question}</div>
        <div class="det-a">Your answer: <b>${det.given || '(no answer)'}</b> — Correct: <b>${det.correct}</b></div>
      </div>
    </div>`).join('');

  speak(`Exam submitted. You scored ${d.score} out of ${d.total}. ${d.percent} percent. ${pass ? 'Well done!' : 'Keep practising!'}`);
}

function goHome() {
  showPage(currentUser?.role === 'admin' ? 'admin' : 'student');
  if (currentUser?.role === 'student') loadStudentTests();
  else loadAdminDashboard();
}

function stopExam() {
  clearInterval(examInterval);
  stopCamera();
  sessionMicActive = false;
  stopRecognitionEngine();
  window.speechSynthesis && window.speechSynthesis.cancel();
  document.removeEventListener('visibilitychange', onTabSwitch);
  window.removeEventListener('blur', onTabSwitch);
}

// ─── Admin ────────────────────────────────────────────
function adminView(v, btn) {
  document.querySelectorAll('#page-admin .dash-view').forEach(d => d.classList.remove('active'));
  document.getElementById('av-' + v).classList.add('active');
  document.querySelectorAll('#page-admin .nav-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (v === 'dashboard') loadAdminDashboard();
  else if (v === 'students') loadStudents();
  else if (v === 'results') loadAdminResults();
}

async function loadAdminDashboard() {
  const [tests, students, attempts] = await Promise.all([
    fetch('/api/tests').then(r => r.json()),
    fetch('/api/students').then(r => r.json()),
    fetch('/api/attempts').then(r => r.json())
  ]);
  document.getElementById('admin-stats').innerHTML = `
    <div class="stat-box"><div class="stat-num">${students.length}</div><div class="stat-label">Students</div></div>
    <div class="stat-box"><div class="stat-num">${tests.length}</div><div class="stat-label">Tests</div></div>
    <div class="stat-box"><div class="stat-num">${attempts.length}</div><div class="stat-label">Attempts</div></div>
    <div class="stat-box"><div class="stat-num">${attempts.filter(a => a.percent >= 50).length}</div><div class="stat-label">Passed</div></div>`;

  const table = document.getElementById('admin-test-list');
  if (!tests.length) { table.innerHTML = '<p style="color:var(--text2)">No tests yet. Create one!</p>'; return; }
  table.innerHTML = `<table>
    <thead><tr><th>Subject</th><th>Questions</th><th>Duration</th><th>Max Attempts</th><th>Created</th><th>Action</th></tr></thead>
    <tbody>${tests.map(t => `
      <tr>
        <td>${t.subject}</td>
        <td>${t.questions?.length || 0}</td>
        <td>${t.duration} min</td>
        <td>${t.maxAttempts || 2}</td>
        <td>${t.createdAt || '—'}</td>
        <td><button class="btn-del" onclick="deleteTest('${t.id}')">Delete</button></td>
      </tr>`).join('')}
    </tbody></table>`;
}

async function deleteTest(id) {
  if (!confirm('Delete this test?')) return;
  await fetch('/api/tests/' + id, { method: 'DELETE' });
  loadAdminDashboard();
}

async function loadStudents() {
  const students = await fetch('/api/students').then(r => r.json());
  const el = document.getElementById('students-table');
  if (!students.length) { el.innerHTML = '<p style="color:var(--text2)">No students registered.</p>'; return; }
  el.innerHTML = `<table>
    <thead><tr><th>Name</th><th>Reg No</th><th>Email</th><th>Joined</th><th>Action</th></tr></thead>
    <tbody>${students.map(s => `
      <tr>
        <td>${s.name}</td><td>${s.regNo || '—'}</td>
        <td>${s.email}</td><td>${s.createdAt || '—'}</td>
        <td><button class="btn-del" onclick="deleteStudent('${s.id}')">Remove</button></td>
      </tr>`).join('')}
    </tbody></table>`;
}

async function deleteStudent(id) {
  if (!confirm('Remove this student?')) return;
  await fetch('/api/students/' + id, { method: 'DELETE' });
  loadStudents();
}

async function loadAdminResults(filterTest = null) {
  const [attempts, tests] = await Promise.all([
    fetch('/api/attempts').then(r => r.json()),
    fetch('/api/tests').then(r => r.json())
  ]);
  const fb = document.getElementById('subject-filter');
  fb.innerHTML = `<button class="filter-btn ${!filterTest ? 'active' : ''}" onclick="loadAdminResults(null)">All</button>` +
    tests.map(t => `<button class="filter-btn ${filterTest === t.id ? 'active' : ''}" onclick="loadAdminResults('${t.id}')">${t.subject}</button>`).join('');
  const list = filterTest ? attempts.filter(a => a.testId === filterTest) : attempts;
  const el = document.getElementById('results-table');
  if (!list.length) { el.innerHTML = '<p style="color:var(--text2)">No results found.</p>'; return; }
  el.innerHTML = `<table>
    <thead><tr><th>Student</th><th>Reg No</th><th>Subject</th><th>Score</th><th>%</th><th>Status</th><th>Date</th><th>Flags</th></tr></thead>
    <tbody>${list.map(a => `
      <tr>
        <td>${a.studentName || '—'}</td><td>${a.studentReg || '—'}</td>
        <td>${a.subject || a.testSubject || '—'}</td>
        <td>${a.score}/${a.total}</td><td>${a.percent}%</td>
        <td><span class="badge ${a.percent >= 50 ? 'badge-pass' : 'badge-fail'}">${a.percent >= 50 ? 'PASS' : 'FAIL'}</span></td>
        <td>${new Date(a.submittedAt).toLocaleDateString()}</td>
        <td style="font-size:.72rem;color:var(--warn)">
          ${a.tabWarnings ? `🖥️${a.tabWarnings} ` : ''}
          ${a.camWarnings ? `📷${a.camWarnings} ` : ''}
          ${a.autoSubmitted ? '⛔' : ''}
        </td>
      </tr>`).join('')}
    </tbody></table>`;
}

// ─── Create Test — FIXED options bug ─────────────────
let questionCount = 0;
// Track actual question IDs to handle removals correctly
let questionIds = [];

function addQuestion() {
  if (questionIds.length >= 20) { alert('Maximum 20 questions allowed.'); return; }
  const qid = Date.now(); // unique ID, not sequential
  questionIds.push(qid);
  updateQuestionCount();

  const div = document.createElement('div');
  div.className = 'q-item';
  div.id = `qi-${qid}`;
  div.innerHTML = `
    <div class="q-item-header">
      <span class="q-item-num">Q${questionIds.length}</span>
      <button class="btn-del" onclick="removeQuestion(${qid})">Remove</button>
    </div>
    <div class="field-group">
      <label>Question Text</label>
      <input type="text" id="qt-${qid}" placeholder="Enter question..."/>
    </div>
    <div class="field-group">
      <label>Options (A – D)</label>
      <div class="options-wrap">
        <div class="opt-item"><label>A</label><input type="text" id="qa-${qid}" placeholder="Option A"/></div>
        <div class="opt-item"><label>B</label><input type="text" id="qb-${qid}" placeholder="Option B"/></div>
        <div class="opt-item"><label>C</label><input type="text" id="qc-${qid}" placeholder="Option C"/></div>
        <div class="opt-item"><label>D</label><input type="text" id="qd-${qid}" placeholder="Option D"/></div>
      </div>
    </div>
    <div class="field-group">
      <label>Correct Answer</label>
      <select class="answer-sel" id="qans-${qid}">
        <option value="">-- Select correct answer --</option>
        <option value="A">A</option>
        <option value="B">B</option>
        <option value="C">C</option>
        <option value="D">D</option>
      </select>
    </div>`;
  document.getElementById('questions-list').appendChild(div);
}

function removeQuestion(qid) {
  const el = document.getElementById(`qi-${qid}`);
  if (el) el.remove();
  questionIds = questionIds.filter(id => id !== qid);
  updateQuestionCount();
  // Re-number visible questions
  document.querySelectorAll('.q-item-num').forEach((el, i) => { el.textContent = `Q${i + 1}`; });
}

function updateQuestionCount() {
  questionCount = questionIds.length;
  const el = document.getElementById('q-count');
  if (el) el.textContent = `(${questionCount})`;
}

async function submitTest() {
  const subject = document.getElementById('ct-subject').value.trim();
  const desc = document.getElementById('ct-desc').value.trim();
  const duration = parseInt(document.getElementById('ct-duration').value) || 30;
  const maxAttempts = parseInt(document.getElementById('ct-attempts').value) || 2;
  const errEl = document.getElementById('create-err');
  errEl.textContent = '';
  errEl.style.color = 'var(--danger)';

  if (!subject) { errEl.textContent = 'Subject name is required'; return; }
  if (questionIds.length < 5) { errEl.textContent = `Minimum 5 questions required (currently ${questionIds.length})`; return; }

  const questions = [];
  for (const qid of questionIds) {
    const qText = (document.getElementById(`qt-${qid}`)?.value || '').trim();
    const optA  = (document.getElementById(`qa-${qid}`)?.value || '').trim();
    const optB  = (document.getElementById(`qb-${qid}`)?.value || '').trim();
    const optC  = (document.getElementById(`qc-${qid}`)?.value || '').trim();
    const optD  = (document.getElementById(`qd-${qid}`)?.value || '').trim();
    const ans   = (document.getElementById(`qans-${qid}`)?.value || '');

    if (!qText) { errEl.textContent = `Question ${questions.length + 1} text is missing`; return; }
    if (!optA || !optB || !optC || !optD) { errEl.textContent = `Question ${questions.length + 1}: all 4 options are required`; return; }
    if (!ans) { errEl.textContent = `Question ${questions.length + 1}: please select the correct answer`; return; }

    const ansMap = { A: optA, B: optB, C: optC, D: optD };
    questions.push({
      question: qText,
      options: [optA, optB, optC, optD],  // always all 4
      answer: ansMap[ans]
    });
  }

  const r = await fetch('/api/tests', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject, description: desc, duration, maxAttempts, questions })
  });
  const d = await r.json();
  if (d.ok) {
    errEl.style.color = 'var(--success)';
    errEl.textContent = '✓ Test published successfully!';
    // Reset form
    questionIds = [];
    questionCount = 0;
    document.getElementById('q-count').textContent = '(0)';
    document.getElementById('questions-list').innerHTML = '';
    document.getElementById('ct-subject').value = '';
    document.getElementById('ct-desc').value = '';
  } else {
    errEl.textContent = d.msg || 'Failed to publish test';
  }
}

// ─── Keyboard Shortcuts ───────────────────────────────
document.addEventListener('keydown', e => {
  if (!document.getElementById('page-exam').classList.contains('active')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'ArrowRight') nextQ();
  if (e.key === 'ArrowLeft') prevQ();
  if (e.key === ' ') { e.preventDefault(); toggleSessionMic(); }
  if (e.key === 'r' || e.key === 'R') readQuestion();
});
