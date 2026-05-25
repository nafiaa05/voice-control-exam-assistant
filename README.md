# 🎙️ VoiceExam — AI Voice Examination System

## Quick Setup

### 1. Install Python dependency (only Flask needed)
```bash
pip install flask
```

### 2. Run the app
```bash
cd voice_exam
python app.py
```

### 3. Open browser
Visit: **http://localhost:5000**

Use **Google Chrome** for best voice support (Web Speech API).

---

## Default Login
| Role  | Email            | Password  |
|-------|-----------------|-----------|
| Admin | admin@exam.com  | admin123  |

Students can register from the login page.

---

## Project Structure
```
voice_exam/
├── app.py            ← Flask backend (all API routes)
├── studentdb.json    ← Local JSON database (auto-created)
├── templates/
│   └── index.html    ← Single-page frontend
└── static/
    ├── style.css     ← Styles
    └── app.js        ← Frontend logic + voice
```

---

## Features
### Student
- Register & Login
- View available tests with attempt tracker
- **Voice-based exam** — press 🎙️ mic button to speak your answer
- TTS reads out each question automatically
- Tab-switch detection (3 warnings → auto-submit)
- Camera monitoring (3 warnings → auto-submit)
- View past results with score breakdown

### Admin
- Create tests (5–20 MCQ questions)
- Set duration and max attempts per student
- Dashboard with live stats
- View all student results by subject
- Delete tests or students

---

## Voice Commands (Exam Page)
| Action | How |
|--------|-----|
| Start voice input | Click 🎙️ mic button |
| Stop recording | Click again (auto-stops on silence) |
| Read question aloud | Click 🔊 Read Question |
| Next question | Press `Enter` key |
| Toggle mic | Press `Spacebar` |

---

## Packages Used
- `flask` — web server & API
- **Browser Web Speech API** — TTS + STT (no Python packages needed for voice)
- No database required — uses `studentdb.json`

## Notes
- Works on low-end laptops (no AI model downloads needed)
- Voice recognition requires internet for Chrome's Web Speech API
- For offline TTS/STT, replace browser Web Speech API with `pyttsx3` + `SpeechRecognition` via audio upload endpoint
