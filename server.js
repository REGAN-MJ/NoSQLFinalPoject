require("dotenv").config();

const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { MongoClient, ObjectId } = require("mongodb");
const path = require("path");

const app = express();
const port = Number(process.env.PORT) || 3000;
const mongoUri = process.env.MONGODB_URI;
const databaseName = process.env.DB_NAME || "student_academic_records";
const defaultAdminUsername = (process.env.ADMIN_USERNAME || "admin").trim().toLowerCase();
const defaultAdminPassword = process.env.ADMIN_PASSWORD || "admin123";
// Grades are converted to points so semester GPA and CGPA can be credit-weighted.
const gradePoints = { A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 };
// Programs are inserted only when their course codes do not already exist.
const initialCourses = [
  { courseCode: "SE", courseName: "Software Engineering", department: "COMPUTING & INFORMATICS" },
  { courseCode: "CSC", courseName: "Computer Science", department: "COMPUTING & INFORMATICS" },
  { courseCode: "BA", courseName: "Business Administration", department: "BUSINESS SCHOOL" },
  { courseCode: "HRM", courseName: "Human Resource Management", department: "BUSINESS SCHOOL" }
];
// Each program contains six semester lists. A unit is [unit code, unit name, credit units].
const demoCourseUnits = {
  SE: [
    [["SE101", "Introduction to Software Engineering", 3], ["CMP101", "Programming Fundamentals", 4], ["MAT101", "Mathematics for Computing I", 3]],
    [["SE201", "Requirements Engineering", 3], ["CMP201", "Object-Oriented Programming", 4], ["DBS201", "Database Systems", 3]],
    [["SE301", "Software Design and Architecture", 3], ["SE302", "Software Quality Assurance", 3], ["NET301", "Computer Networks", 3]],
    [["SE401", "Web Application Development", 4], ["SE402", "Software Testing", 3], ["PRJ401", "Software Engineering Project I", 3]],
    [["SE501", "Mobile Application Development", 3], ["SE502", "Cloud Computing", 3], ["PRJ501", "Software Engineering Project II", 4]],
    [["SE601", "DevOps and Deployment", 3], ["SE602", "Software Security", 3], ["PRJ601", "Final Year Project", 6]]
  ],
  CSC: [
    [["CSC101", "Introduction to Computer Science", 3], ["CSC102", "Programming Fundamentals", 4], ["MAT101", "Discrete Mathematics", 3]],
    [["CSC201", "Data Structures and Algorithms", 4], ["CSC202", "Object-Oriented Programming", 3], ["STA201", "Probability and Statistics", 3]],
    [["CSC301", "Operating Systems", 3], ["CSC302", "Database Systems", 3], ["CSC303", "Computer Organization", 3]],
    [["CSC401", "Computer Networks", 3], ["CSC402", "Theory of Computation", 3], ["CSC403", "Artificial Intelligence", 3]],
    [["CSC501", "Machine Learning", 3], ["CSC502", "Compiler Design", 3], ["CSC503", "Distributed Systems", 3]],
    [["CSC601", "Cybersecurity Fundamentals", 3], ["CSC602", "Data Science", 3], ["PRJ601", "Final Year Project", 6]]
  ],
  BA: [
    [["BUS101", "Introduction to Business", 3], ["ACC101", "Financial Accounting I", 3], ["ECO101", "Principles of Economics", 3]],
    [["BUS201", "Business Communication", 3], ["ACC201", "Financial Accounting II", 3], ["MGT201", "Principles of Management", 3]],
    [["MKT301", "Principles of Marketing", 3], ["FIN301", "Business Finance", 3], ["STA301", "Business Statistics", 3]],
    [["MGT401", "Operations Management", 3], ["LAW401", "Business Law", 3], ["ENT401", "Entrepreneurship", 3]],
    [["STR501", "Strategic Management", 3], ["FIN501", "Investment Management", 3], ["MKT501", "Digital Marketing", 3]],
    [["BUS601", "International Business", 3], ["BUS602", "Business Research Methods", 3], ["PRJ601", "Business Capstone Project", 6]]
  ],
  HRM: [
    [["HRM101", "Introduction to Human Resource Management", 3], ["BUS101", "Introduction to Business", 3], ["COM101", "Communication Skills", 3]],
    [["HRM201", "Organizational Behaviour", 3], ["HRM202", "Human Resource Planning", 3], ["LAW201", "Employment Law", 3]],
    [["HRM301", "Recruitment and Selection", 3], ["HRM302", "Training and Development", 3], ["STA301", "Statistics for Human Resources", 3]],
    [["HRM401", "Compensation and Benefits", 3], ["HRM402", "Performance Management", 3], ["HRM403", "Labour Relations", 3]],
    [["HRM501", "Strategic Human Resource Management", 3], ["HRM502", "Talent Management", 3], ["HRM503", "Human Resource Analytics", 3]],
    [["HRM601", "International Human Resource Management", 3], ["HRM602", "Human Resource Research Methods", 3], ["PRJ601", "Human Resource Management Project", 6]]
  ]
};
let database;

// Parse JSON requests, keep login sessions, serve the browser app, and make MongoDB available to routes.
app.use(express.json({ limit: "30kb" }));
app.use(session({
  name: "academic.sid",
  secret: process.env.SESSION_SECRET || "development-only-change-this-session-secret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 8 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, "public")));
app.use((req, res, next) => {
  req.db = database;
  next();
});

function isAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Please sign in." });
  if (req.session.user.role !== "admin") return res.status(403).json({ error: "Administrator access is required." });
  next();
}

// Student endpoints require a login; admin-only endpoints add a role check as well.
function isSignedIn(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Please sign in." });
  next();
}

function cleanStudent(student) {
  // Never send the stored password hash back to a browser.
  const { passwordHash, ...safeStudent } = student;
  return { ...safeStudent, _id: student._id.toString() };
}

function toApiRecord(record) {
  return { ...record, _id: record._id.toString() };
}

function validAcademicYear(value) {
  const match = /^(\d{4})\/(\d{4})$/.exec(value);
  // Academic years must contain two consecutive calendar years.
  return Boolean(match && Number(match[2]) === Number(match[1]) + 1);
}

// Gather the student's linked records and calculate semester GPA, CGPA, and completion.
async function buildStudentProgress(db, student) {
  const [registrations, units, course] = await Promise.all([
    db.collection("registrations").find({ studentId: student.studentId }).toArray(),
    db.collection("courseUnits").find({ courseCode: student.courseCode }).toArray(),
    db.collection("courses").findOne({ courseCode: student.courseCode })
  ]);
  const results = await db.collection("results").find({ studentId: student.studentId }).toArray();
  const unitById = new Map(units.map((unit) => [unit._id.toString(), unit]));
  const registrationById = new Map(registrations.map((registration) => [registration._id.toString(), registration]));
  const resultRows = results.map((result) => {
    // Results point to registrations, which in turn point to their course units.
    const registration = registrationById.get(result.registrationId.toString());
    const unit = registration?.courseUnitId && unitById.get(registration.courseUnitId.toString());
    return {
      ...result,
      _id: result._id.toString(),
      registrationId: result.registrationId.toString(),
      courseUnitCode: unit?.unitCode || "",
      courseUnitName: unit?.unitName || "Course unit",
      creditUnits: unit?.creditUnits || 0,
      semester: registration?.semester || result.semester,
      academicYear: registration?.academicYear || result.academicYear
    };
  });
  const semesters = Array.from({ length: 6 }, (_, index) => {
    const semester = index + 1;
    const semesterResults = resultRows.filter((result) => result.semester === semester);
    const registered = registrations.filter((registration) => registration.semester === semester);
    // GPA is total grade points weighted by credits, divided by attempted credits.
    const earned = semesterResults.reduce((sum, result) => sum + result.gradePoints * result.creditUnits, 0);
    const credits = semesterResults.reduce((sum, result) => sum + result.creditUnits, 0);
    return {
      semester,
      registeredUnits: registered.length,
      completedUnits: semesterResults.length,
      finished: registered.length > 0 && semesterResults.length >= registered.length,
      gpa: credits ? Number((earned / credits).toFixed(2)) : null,
      results: semesterResults
    };
  });
  const completedResults = resultRows.filter((result) => result.grade !== "F");
  // Failed units count toward attempted CGPA credits, but not toward completion.
  const completedCredits = completedResults.reduce((sum, result) => sum + result.creditUnits, 0);
  const attemptedCredits = resultRows.reduce((sum, result) => sum + result.creditUnits, 0);
  const totalCredits = units.reduce((sum, unit) => sum + Number(unit.creditUnits), 0);
  const totalPoints = resultRows.reduce((sum, result) => sum + result.gradePoints * result.creditUnits, 0);
  return {
    student: { ...cleanStudent(student), courseName: course?.courseName || "" },
    courseUnits: units.length,
    totalCourseUnits: units.length,
    completedCourseUnits: completedResults.length,
    completionPercent: units.length ? Math.round((completedResults.length / units.length) * 100) : 0,
    completedCredits,
    totalCredits,
    cgpa: attemptedCredits ? Number((totalPoints / attemptedCredits).toFixed(2)) : null,
    semestersFinished: semesters.filter((semester) => semester.finished).length,
    semesters,
    results: resultRows
  };
}

// Create either an administrator session or a student session after verifying credentials.
app.post("/api/auth/login", async (req, res, next) => {
  try {
    const { role, identifier, password } = req.body || {};
    if (typeof password !== "string" || !password) return res.status(400).json({ error: "Enter your password." });
    if (role === "admin") {
      const username = typeof identifier === "string" ? identifier.trim().toLowerCase() : "";
      const staffNumber = typeof identifier === "string" ? identifier.trim().toUpperCase() : "";
      const administrator = await req.db.collection("administrators").findOne({
        $or: [{ username }, { staffNumber }]
      });
      if (!administrator || !(await bcrypt.compare(password, administrator.passwordHash))) {
        return res.status(401).json({ error: "Invalid administrator username or password." });
      }
      req.session.user = {
        role: "admin",
        username: administrator.username || administrator.staffNumber,
        fullName: administrator.fullName
      };
      return res.json({ user: req.session.user });
    }
    if (role !== "student" || typeof identifier !== "string" || !identifier.trim()) {
      return res.status(400).json({ error: "Enter a registration number or email address." });
    }
    const lookup = identifier.trim();
    const student = await req.db.collection("students").findOne({
      $or: [{ email: lookup.toLowerCase() }, { studentId: lookup.toUpperCase() }]
    });
    if (student?.signupPending) return res.status(403).json({ error: "Your account is waiting for an administrator to complete your student profile." });
    if (!student?.passwordHash || !(await bcrypt.compare(password, student.passwordHash))) {
      return res.status(401).json({ error: "Invalid student credentials." });
    }
    req.session.user = { role: "student", studentId: student.studentId };
    res.json({ user: { role: "student", studentId: student.studentId, fullName: student.fullName } });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/signup", async (req, res, next) => {
  try {
    const { role, fullName, identifier, password, confirmPassword } = req.body || {};
    if (role !== "student") return res.status(400).json({ error: "Only students can sign up." });
    const normalizedName = typeof fullName === "string" ? fullName.trim() : "";
    const accountId = typeof identifier === "string" ? identifier.trim().toUpperCase() : "";
    if (!normalizedName || normalizedName.length > 100) return res.status(400).json({ error: "Enter your name (up to 100 characters)." });
    if (!/^[A-Z0-9-]{2,40}$/.test(accountId)) return res.status(400).json({ error: "Enter a valid registration number." });
    if (typeof password !== "string" || password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
    if (password !== confirmPassword) return res.status(400).json({ error: "Passwords do not match." });
    const passwordHash = await bcrypt.hash(password, 12);
    await req.db.collection("students").insertOne({
      studentId: accountId,
      fullName: normalizedName,
      passwordHash,
      signupPending: true,
      createdAt: new Date()
    });
    res.status(201).json({ message: "Signup received. An administrator must complete your student profile before you can sign in." });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "An account with that number already exists." });
    next(error);
  }
});

app.get("/api/auth/me", (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: "Please sign in." });
  res.json({ user: req.session.user });
});

app.post("/api/auth/logout", (req, res, next) => {
  req.session.destroy((error) => {
    if (error) return next(error);
    res.clearCookie("academic.sid", { httpOnly: true, sameSite: "lax" });
    res.status(204).end();
  });
});

// Allow login/session routes without authentication, then require a signed-in user for the rest.
app.use("/api", (req, res, next) => {
  if (req.path.startsWith("/auth/")) return next();
  isSignedIn(req, res, next);
});

app.get("/api/student/progress", async (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: "Please sign in." });
  if (req.session.user.role !== "student") return res.status(403).json({ error: "Student access is required." });
  try {
    const student = await req.db.collection("students").findOne({ studentId: req.session.user.studentId });
    if (!student) return res.status(404).json({ error: "Student record not found." });
    res.json(await buildStudentProgress(req.db, student));
  } catch (error) {
    next(error);
  }
});

// All API routes below this point require an administrator session unless they respond earlier.
app.use("/api", isAdmin);

// List collection records. Results are expanded with student and course-unit names for display.
app.get("/api/:resource", async (req, res, next) => {
  const { resource } = req.params;
  if (resource === "registration-overview") return next();
  if (!["students", "courses", "courseUnits", "registrations", "results"].includes(resource)) {
    return res.status(404).json({ error: "Collection not found." });
  }
  try {
    const records = await req.db.collection(resource).find().sort({ _id: -1 }).toArray();
    if (resource === "students") return res.json(records.map(cleanStudent));
    if (resource === "results") {
      const enriched = await Promise.all(records.map(async (result) => {
        const [student, registration] = await Promise.all([
          req.db.collection("students").findOne({ studentId: result.studentId }),
          req.db.collection("registrations").findOne({ _id: result.registrationId })
        ]);
        const unit = registration?.courseUnitId
          ? await req.db.collection("courseUnits").findOne({ _id: registration.courseUnitId })
          : null;
        return {
          ...toApiRecord(result),
          studentName: student?.fullName || result.studentId,
          department: student?.department || "",
          courseName: unit?.unitName || "Course unit",
          courseUnitCode: unit?.unitCode || "",
          semester: registration?.semester || result.semester
        };
      }));
      return res.json(enriched);
    }
    res.json(records.map(toApiRecord));
  } catch (error) {
    next(error);
  }
});

app.get("/api/registration-overview", async (req, res, next) => {
  try {
    const students = await req.db.collection("students").find().sort({ fullName: 1 }).toArray();
    const rows = await Promise.all(students.map(async (student) => {
      const registrations = await req.db.collection("registrations").find({ studentId: student.studentId }).toArray();
      const results = await req.db.collection("results").find({ studentId: student.studentId }).toArray();
      const semesters = Array.from({ length: 6 }, (_, index) => {
        const semester = index + 1;
        const semesterRegistrations = registrations.filter((record) => record.semester === semester);
        const markedIds = new Set(results.map((result) => result.registrationId.toString()));
        const gradedCount = semesterRegistrations.filter((registration) => markedIds.has(registration._id.toString())).length;
        return {
          semester,
          registered: semesterRegistrations.length,
          graded: gradedCount,
          locked: gradedCount > 0,
          units: semesterRegistrations.map((registration) => registration._id.toString())
        };
      });
      return { ...cleanStudent(student), semesters };
    }));
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

// Register every course unit assigned to a student's program for the chosen semester.
app.post("/api/registrations/batch", async (req, res, next) => {
  try {
    const { studentId, semester, academicYear } = req.body || {};
    const semesterNumber = Number(semester);
    if (!studentId || ![1, 2, 3, 4, 5, 6].includes(semesterNumber) || !validAcademicYear(academicYear)) {
      return res.status(400).json({ error: "Choose a student, semester 1–6, and a valid academic year (YYYY/YYYY)." });
    }
    const student = await req.db.collection("students").findOne({ studentId: String(studentId).toUpperCase() });
    if (!student) return res.status(404).json({ error: "Student not found." });
    const existing = await req.db.collection("registrations").find({
      studentId: student.studentId,
      semester: semesterNumber
    }).toArray();
    // Once any result exists in a semester, keep its registration list fixed.
    const graded = await req.db.collection("results").findOne({
      studentId: student.studentId,
      semester: semesterNumber
    });
    if (graded) return res.status(409).json({ error: "This semester already has marks and can no longer be changed." });
    const units = await req.db.collection("courseUnits").find({
      courseCode: student.courseCode,
      semester: semesterNumber
    }).toArray();
    if (!units.length) return res.status(400).json({ error: "There are no course units configured for this program and semester." });
    const additions = units.filter((unit) => !existing.some((registration) =>
      registration.courseUnitId?.toString() === unit._id.toString()
    ));
    if (!additions.length) return res.status(409).json({ error: "All course units for this semester are already registered." });
    const result = await req.db.collection("registrations").insertMany(additions.map((unit) => ({
      studentId: student.studentId,
      courseCode: student.courseCode,
      courseUnitId: unit._id,
      academicYear,
      semester: semesterNumber,
      createdAt: new Date()
    })));
    res.status(201).json({ registered: result.insertedCount });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "One or more of these units are already registered for that year and semester." });
    next(error);
  }
});

// Validate and normalize fields before creating or updating MongoDB records.
function validateRecord(resource, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "A valid JSON object is required.";
  if (resource === "students") {
    const required = ["studentId", "fullName", "courseCode", "academicYear", "gender", "email"];
    for (const key of required) if (input[key] === undefined || String(input[key]).trim() === "") return `${key} is required.`;
    const record = {
      studentId: String(input.studentId).trim().toUpperCase(),
      fullName: String(input.fullName).trim(),
      courseCode: String(input.courseCode).trim().toUpperCase(),
      academicYear: String(input.academicYear).trim(),
      gender: String(input.gender).trim(),
      email: String(input.email).trim().toLowerCase()
    };
    if (!/^[A-Z0-9-]+$/.test(record.studentId)) return "Registration number can contain letters, numbers, and hyphens only.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)) return "Enter a valid email address.";
    if (!["Female", "Male"].includes(record.gender)) return "Choose Male or Female.";
    if (!validAcademicYear(record.academicYear)) return "Academic year must use consecutive years, such as 2025/2026.";
    if (input.password && String(input.password).length < 8) return "Student password must be at least 8 characters.";
    if (!input.password && !input._editing) return "Password is required for a new student.";
    return record;
  }
  if (resource === "courses") {
    const courseCode = String(input.courseCode || "").trim().toUpperCase();
    const courseName = String(input.courseName || "").trim();
    const department = String(input.department || "").trim();
    if (!courseCode || !courseName || !department) return "Course code, course name, and department are required.";
    if (!/^[A-Z0-9-]+$/.test(courseCode)) return "Course code can contain letters, numbers, and hyphens only.";
    return { courseCode, courseName, department };
  }
  if (resource === "courseUnits") {
    const courseCode = String(input.courseCode || "").trim().toUpperCase();
    const unitCode = String(input.unitCode || "").trim().toUpperCase();
    const unitName = String(input.unitName || "").trim();
    const semester = Number(input.semester);
    const creditUnits = Number(input.creditUnits);
    if (!courseCode || !unitCode || !unitName) return "Program, unit code, and unit name are required.";
    if (![1, 2, 3, 4, 5, 6].includes(semester)) return "Semester must be between 1 and 6.";
    if (!Number.isInteger(creditUnits) || creditUnits < 1 || creditUnits > 10) return "Credit units must be a whole number between 1 and 10.";
    return { courseCode, unitCode, unitName, semester, creditUnits };
  }
  return "Unsupported record type.";
}

app.post("/api/:resource", async (req, res, next) => {
  const { resource } = req.params;
  if (resource === "results") {
    try {
      const { registrationId, grade } = req.body || {};
      const normalizedGrade = String(grade || "").toUpperCase();
      if (!ObjectId.isValid(registrationId) || !Object.hasOwn(gradePoints, normalizedGrade)) {
        return res.status(400).json({ error: "Select a registered course and grade." });
      }
      const registration = await req.db.collection("registrations").findOne({ _id: new ObjectId(registrationId) });
      if (!registration) return res.status(404).json({ error: "Registration not found." });
      // Take the student, semester, and year from the saved registration rather than client input.
      const unit = await req.db.collection("courseUnits").findOne({ _id: registration.courseUnitId });
      if (!unit) return res.status(404).json({ error: "The registered course unit no longer exists." });
      const result = {
        registrationId: registration._id,
        studentId: registration.studentId,
        grade: normalizedGrade,
        gradePoints: gradePoints[normalizedGrade],
        semester: registration.semester,
        academicYear: registration.academicYear,
        createdAt: new Date()
      };
      const inserted = await req.db.collection("results").insertOne(result);
      return res.status(201).json({
        ...toApiRecord({ ...result, _id: inserted.insertedId }),
        courseUnitCode: unit.unitCode,
        courseName: unit.unitName,
        creditUnits: unit.creditUnits
      });
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ error: "A result has already been recorded for this registration." });
      return next(error);
    }
  }
  if (!["students", "courses", "courseUnits"].includes(resource)) return res.status(404).json({ error: "Collection not found." });
  const record = validateRecord(resource, req.body);
  if (typeof record === "string") return res.status(400).json({ error: record });
  try {
    if (resource === "students") {
      const course = await req.db.collection("courses").findOne({ courseCode: record.courseCode });
      if (!course) return res.status(400).json({ error: "Select an available program." });
      record.department = course.department;
      // Hash passwords before saving; the plain password is never persisted.
      record.passwordHash = await bcrypt.hash(req.body.password, 12);
      record.createdAt = new Date();
    } else if (resource === "courseUnits") {
      const course = await req.db.collection("courses").findOne({ courseCode: record.courseCode });
      if (!course) return res.status(400).json({ error: "Select an available program." });
    }
    const result = await req.db.collection(resource).insertOne(record);
    const created = { ...record, _id: result.insertedId };
    res.status(201).json(resource === "students" ? cleanStudent(created) : toApiRecord(created));
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "A record with that code or registration number already exists." });
    next(error);
  }
});

app.put("/api/:resource/:id", async (req, res, next) => {
  const { resource, id } = req.params;
  if (!["students", "courses", "courseUnits", "results"].includes(resource)) return res.status(404).json({ error: "Collection not found." });
  if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid record ID." });
  try {
    let update;
    if (resource === "results") {
      // Editing a grade also updates the points used in GPA calculations.
      const grade = String(req.body.grade || "").toUpperCase();
      if (!Object.hasOwn(gradePoints, grade)) return res.status(400).json({ error: "Choose a grade from A to F." });
      update = { grade, gradePoints: gradePoints[grade], updatedAt: new Date() };
    } else {
      const body = { ...req.body, _editing: resource === "students" };
      const record = validateRecord(resource, body);
      if (typeof record === "string") return res.status(400).json({ error: record });
      update = record;
      if (resource === "students") {
        const course = await req.db.collection("courses").findOne({ courseCode: record.courseCode });
        if (!course) return res.status(400).json({ error: "Select an available program." });
        const current = await req.db.collection("students").findOne({ _id: new ObjectId(id) });
        if (current && (current.courseCode !== record.courseCode || current.studentId !== record.studentId) &&
            await req.db.collection("registrations").findOne({ studentId: current.studentId })) {
          return res.status(409).json({ error: "A student's registration number and program cannot change after course registration." });
        }
        record.department = course.department;
        record.signupPending = false;
        // A blank password on edit means keep the existing hash.
        if (req.body.password) record.passwordHash = await bcrypt.hash(req.body.password, 12);
        else delete record.passwordHash;
        update = record;
      }
      if (resource === "courses") {
        const current = await req.db.collection("courses").findOne({ _id: new ObjectId(id) });
        if (current && current.courseCode !== record.courseCode) {
          const [hasStudents, hasUnits] = await Promise.all([
            req.db.collection("students").findOne({ courseCode: current.courseCode }),
            req.db.collection("courseUnits").findOne({ courseCode: current.courseCode })
          ]);
          if (hasStudents || hasUnits) return res.status(409).json({ error: "A program code cannot change while it has students or course units." });
        }
        if (current && current.department !== record.department) {
          await req.db.collection("students").updateMany(
            { courseCode: current.courseCode },
            { $set: { department: record.department } }
          );
        }
      }
      if (resource === "courseUnits") {
        if (!(await req.db.collection("courses").findOne({ courseCode: record.courseCode }))) {
          return res.status(400).json({ error: "Select an available program." });
        }
        const current = await req.db.collection("courseUnits").findOne({ _id: new ObjectId(id) });
        if (current && await req.db.collection("registrations").findOne({ courseUnitId: current._id }) &&
            (current.courseCode !== record.courseCode || current.semester !== record.semester || current.creditUnits !== record.creditUnits)) {
          return res.status(409).json({ error: "A registered course unit's program, semester, and credit units cannot be changed." });
        }
      }
    }
    const result = await req.db.collection(resource).findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { ...update, updatedAt: new Date() } },
      { returnDocument: "after" }
    );
    if (!result) return res.status(404).json({ error: "Record not found." });
    res.json(resource === "students" ? cleanStudent(result) : toApiRecord(result));
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "A record with that code or registration number already exists." });
    next(error);
  }
});

app.delete("/api/:resource/:id", async (req, res, next) => {
  const { resource, id } = req.params;
  if (!["students", "courses", "courseUnits", "results"].includes(resource)) return res.status(404).json({ error: "Collection not found." });
  if (!ObjectId.isValid(id)) return res.status(400).json({ error: "Invalid record ID." });
  try {
    const objectId = new ObjectId(id);
    // Results can be removed; other records are protected while academic history refers to them.
    if (resource === "results") {
      const result = await req.db.collection("results").deleteOne({ _id: objectId });
      if (!result.deletedCount) return res.status(404).json({ error: "Record not found." });
      return res.status(204).end();
    }
    if (resource === "students") {
      const student = await req.db.collection("students").findOne({ _id: objectId });
      if (student && await req.db.collection("registrations").findOne({ studentId: student.studentId })) {
        return res.status(409).json({ error: "Delete this student's results and registrations before deleting the student." });
      }
    }
    if (resource === "courses") {
      const course = await req.db.collection("courses").findOne({ _id: objectId });
      if (course && await req.db.collection("students").findOne({ courseCode: course.courseCode })) {
        return res.status(409).json({ error: "This program has students assigned to it and cannot be deleted." });
      }
      if (course && await req.db.collection("courseUnits").findOne({ courseCode: course.courseCode })) {
        return res.status(409).json({ error: "Delete this program's course units before deleting it." });
      }
    }
    if (resource === "courseUnits") {
      const unit = await req.db.collection("courseUnits").findOne({ _id: objectId });
      if (unit && await req.db.collection("registrations").findOne({ courseUnitId: objectId })) {
        return res.status(409).json({ error: "This course unit has registrations and cannot be deleted." });
      }
    }
    const result = await req.db.collection(resource).deleteOne({ _id: objectId });
    if (!result.deletedCount) return res.status(404).json({ error: "Record not found." });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: "An unexpected server error occurred." });
});

// Connect to MongoDB, prepare indexes and demo data, then start accepting requests.
async function start() {
  if (!mongoUri) throw new Error("MONGODB_URI is required. Copy .env.example to .env and configure your MongoDB connection.");
  if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) throw new Error("SESSION_SECRET is required in production.");
  const client = new MongoClient(mongoUri);
  await client.connect();
  database = client.db(databaseName);
  let registrationIndexes = [];
  try {
    registrationIndexes = await database.collection("registrations").indexes();
  } catch (error) {
    if (error.code !== 26) throw error;
  }
  const legacyRegistrationIndex = registrationIndexes.find((index) =>
    index.name === "studentId_1_courseCode_1_academicYear_1_semester_1"
  );
  if (legacyRegistrationIndex) {
    // Remove the older registration index so the new course-unit-based rule can be installed.
    await database.collection("registrations").dropIndex(legacyRegistrationIndex.name);
  }
  let studentIndexes = [];
  try {
    studentIndexes = await database.collection("students").indexes();
  } catch (error) {
    if (error.code !== 26) throw error;
  }
  const legacyEmailIndex = studentIndexes.find((index) =>
    index.name === "email_1" && !index.partialFilterExpression
  );
  if (legacyEmailIndex) await database.collection("students").dropIndex(legacyEmailIndex.name);
  // Indexes prevent duplicate identities, course units, registrations, and results.
  await Promise.all([
    database.collection("students").createIndex({ studentId: 1 }, { unique: true }),
    database.collection("students").createIndex({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string" } } }),
    database.collection("administrators").createIndex({ staffNumber: 1 }, { unique: true }),
    database.collection("administrators").createIndex(
      { username: 1 },
      { unique: true, partialFilterExpression: { username: { $type: "string" } } }
    ),
    database.collection("courses").createIndex({ courseCode: 1 }, { unique: true }),
    database.collection("courseUnits").createIndex({ unitCode: 1, courseCode: 1 }, { unique: true }),
    database.collection("registrations").createIndex(
      { studentId: 1, courseUnitId: 1, semester: 1 },
      { unique: true, partialFilterExpression: { courseUnitId: { $exists: true } } }
    ),
    database.collection("results").createIndex({ registrationId: 1 }, { unique: true }),
    database.collection("results").createIndex({ studentId: 1, semester: 1 })
  ]);
  const administrators = database.collection("administrators");
  if (!(await administrators.findOne({ username: defaultAdminUsername }))) {
    await administrators.insertOne({
      username: defaultAdminUsername,
      fullName: "Administrator",
      passwordHash: await bcrypt.hash(defaultAdminPassword, 12),
      createdAt: new Date()
    });
  }
  for (const course of initialCourses) {
    await database.collection("courses").updateOne(
      { courseCode: course.courseCode },
      { $setOnInsert: course },
      { upsert: true }
    );
  }
  // Seed only empty program/semester combinations so existing curriculum edits are preserved.
  for (const [courseCode, semesters] of Object.entries(demoCourseUnits)) {
    for (const [index, units] of semesters.entries()) {
      const semester = index + 1;
      const existingCount = await database.collection("courseUnits").countDocuments({ courseCode, semester });
      if (existingCount > 0) continue;
      await database.collection("courseUnits").insertMany(units.map(([unitCode, unitName, creditUnits]) => ({
        courseCode,
        unitCode,
        unitName,
        semester,
        creditUnits,
        isDemo: true
      })));
    }
  }
  app.listen(port, () => console.log(`Student Academic Portal is running at http://localhost:${port}`));
}

start().catch((error) => {
  console.error("Could not start the application:", error.message);
  process.exitCode = 1;
});
