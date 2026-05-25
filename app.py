"""
Voice Control Exam Assistant - Backend
Run: python app.py
Requires: flask (pip install flask)
"""

from flask import Flask, request, jsonify, render_template, send_from_directory
import json, os, datetime, hashlib

app = Flask(__name__)
DB_FILE = "studentdb.json"

# ─── DB Helpers ───────────────────────────────────────────────────────────────

def load_db():
    if not os.path.exists(DB_FILE):
        default = {
            "users": [
                {"id": "admin", "name": "Admin", "email": "admin@exam.com",
                 "password": _hash("admin123"), "role": "admin"}
            ],
            "students": [],
            "tests": [],
            "attempts": []
        }
        save_db(default)
    with open(DB_FILE, "r") as f:
        return json.load(f)

def save_db(data):
    with open(DB_FILE, "w") as f:
        json.dump(data, f, indent=2)

def _hash(pw):
    return hashlib.sha256(pw.encode()).hexdigest()

def _id():
    return hashlib.md5(str(datetime.datetime.now()).encode()).hexdigest()[:8]

# ─── Auth ─────────────────────────────────────────────────────────────────────

@app.route("/api/login", methods=["POST"])
def login():
    d = request.json
    db = load_db()
    email, pw = d.get("email",""), d.get("password","")
    hpw = _hash(pw)
    # check admin
    for u in db["users"]:
        if u["email"] == email and u["password"] == hpw:
            return jsonify({"ok": True, "role": "admin", "name": u["name"], "id": u["id"]})
    # check students
    for s in db["students"]:
        if s["email"] == email and s["password"] == hpw:
            return jsonify({"ok": True, "role": "student", "name": s["name"],
                            "id": s["id"], "regNo": s.get("regNo","")})
    return jsonify({"ok": False, "msg": "Invalid credentials"}), 401

@app.route("/api/register", methods=["POST"])
def register():
    d = request.json
    db = load_db()
    for s in db["students"]:
        if s["email"] == d["email"]:
            return jsonify({"ok": False, "msg": "Email already registered"}), 400
    student = {
        "id": _id(),
        "name": d["name"],
        "email": d["email"],
        "regNo": d.get("regNo", ""),
        "password": _hash(d["password"]),
        "role": "student",
        "createdAt": str(datetime.date.today())
    }
    db["students"].append(student)
    save_db(db)
    return jsonify({"ok": True, "id": student["id"]})

# ─── Tests ────────────────────────────────────────────────────────────────────

@app.route("/api/tests", methods=["GET"])
def get_tests():
    db = load_db()
    sid = request.args.get("studentId")
    tests = db["tests"]
    if sid:
        # attach attempt info per student
        result = []
        for t in tests:
            attempts = [a for a in db["attempts"] if a["testId"] == t["id"] and a["studentId"] == sid]
            result.append({**t, "attemptCount": len(attempts),
                           "bestScore": max([a["score"] for a in attempts], default=None)})
        return jsonify(result)
    return jsonify(tests)

@app.route("/api/tests", methods=["POST"])
def create_test():
    d = request.json
    db = load_db()
    qs = d.get("questions", [])
    if not (5 <= len(qs) <= 20):
        return jsonify({"ok": False, "msg": "Questions must be between 5 and 20"}), 400
    test = {
        "id": _id(),
        "subject": d["subject"],
        "description": d.get("description", ""),
        "maxAttempts": d.get("maxAttempts", 2),
        "duration": d.get("duration", 30),  # minutes
        "questions": qs,
        "createdAt": str(datetime.date.today()),
        "active": True
    }
    db["tests"].append(test)
    save_db(db)
    return jsonify({"ok": True, "id": test["id"]})

@app.route("/api/tests/<tid>", methods=["DELETE"])
def delete_test(tid):
    db = load_db()
    db["tests"] = [t for t in db["tests"] if t["id"] != tid]
    save_db(db)
    return jsonify({"ok": True})

@app.route("/api/tests/<tid>", methods=["GET"])
def get_test(tid):
    db = load_db()
    for t in db["tests"]:
        if t["id"] == tid:
            return jsonify(t)
    return jsonify({"ok": False}), 404

# ─── Attempts ─────────────────────────────────────────────────────────────────

@app.route("/api/attempts", methods=["POST"])
def submit_attempt():
    d = request.json
    db = load_db()
    sid = d["studentId"]
    tid = d["testId"]
    # count existing attempts
    existing = [a for a in db["attempts"] if a["testId"] == tid and a["studentId"] == sid]
    test = next((t for t in db["tests"] if t["id"] == tid), None)
    if not test:
        return jsonify({"ok": False, "msg": "Test not found"}), 404
    if len(existing) >= test.get("maxAttempts", 2):
        return jsonify({"ok": False, "msg": "Max attempts reached"}), 400

    # score
    answers = d.get("answers", {})
    score = 0
    total = len(test["questions"])
    details = []
    for i, q in enumerate(test["questions"]):
        key = str(i)
        given = answers.get(key, "").strip().lower()
        correct = q["answer"].strip().lower()
        is_correct = given == correct
        if is_correct:
            score += 1
        details.append({"question": q["question"], "given": answers.get(key,""),
                         "correct": q["answer"], "isCorrect": is_correct})

    attempt = {
        "id": _id(),
        "studentId": sid,
        "testId": tid,
        "subject": test["subject"],
        "score": score,
        "total": total,
        "percent": round(score / total * 100, 1) if total else 0,
        "details": details,
        "tabWarnings": d.get("tabWarnings", 0),
        "cameraWarnings": d.get("cameraWarnings", 0),
        "autoSubmitted": d.get("autoSubmitted", False),
        "submittedAt": datetime.datetime.now().isoformat()
    }
    db["attempts"].append(attempt)
    save_db(db)
    return jsonify({"ok": True, "score": score, "total": total,
                    "percent": attempt["percent"], "details": details, "attemptId": attempt["id"]})

@app.route("/api/attempts", methods=["GET"])
def get_attempts():
    db = load_db()
    sid = request.args.get("studentId")
    tid = request.args.get("testId")
    res = db["attempts"]
    if sid:
        res = [a for a in res if a["studentId"] == sid]
    if tid:
        res = [a for a in res if a["testId"] == tid]
    # enrich with student name
    student_map = {s["id"]: s for s in db["students"]}
    test_map = {t["id"]: t for t in db["tests"]}
    enriched = []
    for a in res:
        s = student_map.get(a["studentId"], {})
        enriched.append({**a, "studentName": s.get("name","?"),
                          "studentReg": s.get("regNo",""),
                          "testSubject": test_map.get(a["testId"],{}).get("subject","?")})
    return jsonify(enriched)

# ─── Students (admin) ─────────────────────────────────────────────────────────

@app.route("/api/students", methods=["GET"])
def get_students():
    db = load_db()
    safe = [{k:v for k,v in s.items() if k != "password"} for s in db["students"]]
    return jsonify(safe)

@app.route("/api/students/<sid>", methods=["DELETE"])
def delete_student(sid):
    db = load_db()
    db["students"] = [s for s in db["students"] if s["id"] != sid]
    save_db(db)
    return jsonify({"ok": True})

# ─── TTS via Web Speech (browser-native, no server needed) ───────────────────
# The browser handles TTS/STT natively via Web Speech API

@app.route("/")
def index():
    return render_template("index.html")

if __name__ == "__main__":
    load_db()  # init db
    print("\n🎙️  Voice Exam Assistant running at http://localhost:5000\n")
    app.run(debug=False, port=5000)
