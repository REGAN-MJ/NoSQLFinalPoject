// Form fields and table columns for the records that administrators can manage.
const configurations = {
  students: {
    title: "Students",
    singular: "student",
    description: "Student logins, programs, and registration details.",
    fields: [
      { key: "studentId", label: "Registration number", placeholder: "e.g. STU001" },
      { key: "fullName", label: "Student name", placeholder: "Full name" },
      { key: "courseCode", label: "Program", type: "course" },
      { key: "academicYear", label: "Academic year", placeholder: "e.g. 2025/2026" },
      { key: "email", label: "Email address", type: "email", placeholder: "student@university.edu" },
      { key: "gender", label: "Gender", type: "select", options: ["Male", "Female"] },
      { key: "password", label: "Password", type: "password", placeholder: "At least 8 characters", optionalEdit: true }
    ],
    columns: [["studentId", "REG. NO."], ["fullName", "STUDENT"], ["email", "EMAIL"], ["courseCode", "PROGRAM"], ["department", "DEPARTMENT"], ["academicYear", "ACADEMIC YEAR"], ["gender", "GENDER"]]
  },
  courses: {
    title: "Programs",
    singular: "program",
    description: "Manage academic programs and the departments they belong to.",
    fields: [
      { key: "courseCode", label: "Program code", placeholder: "e.g. CSC" },
      { key: "courseName", label: "Program name", placeholder: "e.g. Computer Science" },
      { key: "department", label: "Department", type: "select", options: ["COMPUTING & INFORMATICS", "BUSINESS SCHOOL"] }
    ],
    columns: [["courseCode", "CODE"], ["courseName", "PROGRAM"], ["department", "DEPARTMENT"]]
  },
  courseUnits: {
    title: "Course units",
    singular: "course unit",
    description: "Build each program's six-semester curriculum and credit units.",
    fields: [
      { key: "courseCode", label: "Program", type: "course" },
      { key: "unitCode", label: "Unit code", placeholder: "e.g. CSC101" },
      { key: "unitName", label: "Course unit name", placeholder: "e.g. Programming Fundamentals" },
      { key: "semester", label: "Semester", type: "select", options: ["1", "2", "3", "4", "5", "6"] },
      { key: "creditUnits", label: "Credit units", type: "number", min: 1, max: 10 }
    ],
    columns: [["courseCode", "PROGRAM"], ["unitCode", "UNIT CODE"], ["unitName", "COURSE UNIT"], ["semester", "SEMESTER"], ["creditUnits", "CREDITS"]]
  }
};

// Shared browser state: records are loaded from the API and reused by each screen.
const state = {
  user: null,
  role: "student",
  records: { students: [], courses: [], courseUnits: [], registrations: [], results: [] },
  registrationOverview: [],
  currentView: "overview",
  formResource: null,
  editingId: null,
  registeringStudent: null,
  toastTimer: null
};
const $ = (selector) => document.querySelector(selector);

// Escape text before placing database values inside generated HTML.
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

// Send JSON requests to the server and turn API errors into readable messages.
async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers }
  });
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try { message = (await response.json()).error || message; } catch {}
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return response.json();
}

// Show short success or error messages without interrupting the workflow.
function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.toggle("error", error);
  element.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => element.classList.remove("show"), 3000);
}

// Switch between the login form, administrator dashboard, and student portal.
function setScreen(screen) {
  $("#login-screen").hidden = screen !== "login";
  $("#admin-app").hidden = screen !== "admin";
  $("#student-app").hidden = screen !== "student";
}

function setLoginRole(role) {
  state.role = role;
  document.querySelectorAll(".login-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.loginRole === role));
  $("#login-identifier-label").textContent = role === "admin" ? "Administrator username" : "Registration number or email";
  $("#login-identifier").placeholder = role === "admin" ? "Admin" : "e.g. STU001 or student@email.com";
  $("#login-hint").textContent = role === "admin"
    ? "Default account: Admin / Admin123. Change these credentials in your environment settings."
    : "Use your university registration number or email and password.";
}

function setToday() {
  $("#today").textContent = new Intl.DateTimeFormat("en", { weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date());
}

// Resolve a stored program code to its display name using the loaded program list.
function programName(code) {
  return state.records.courses.find((course) => course.courseCode === code)?.courseName || code || "—";
}

function unitById(id) {
  return state.records.courseUnits.find((unit) => unit._id === String(id));
}

function registrationById(id) {
  return state.records.registrations.find((registration) => registration._id === String(id));
}

function resultRegistrationId(result) {
  return String(result.registrationId);
}

// Refresh the dashboard totals from the currently loaded records.
function renderOverview() {
  $("#stat-students").textContent = state.records.students.length;
  $("#stat-courses").textContent = state.records.courses.length;
  $("#stat-courseUnits").textContent = state.records.courseUnits.length;
  $("#stat-results").textContent = state.records.results.length;
  $("#count-students").textContent = state.records.students.length;
  $("#count-courses").textContent = state.records.courses.length;
  $("#count-courseUnits").textContent = state.records.courseUnits.length;
}

function displayRecordValue(resource, key, record) {
  const value = record[key];
  if (value === undefined || value === null || value === "") return "—";
  if (key === "courseCode") return resource === "courseUnits" || resource === "students" ? programName(value) : value;
  if (key === "semester") return `Semester ${value}`;
  if (key === "creditUnits") return `${value} units`;
  return String(value);
}

// Filter and render a collection table, including its edit and delete controls.
function renderRecords(resource) {
  const config = configurations[resource];
  const query = $("#search-input").value.trim().toLowerCase();
  const records = state.records[resource].filter((record) =>
    config.columns.map(([key]) => displayRecordValue(resource, key, record)).join(" ").toLowerCase().includes(query)
  );
  $("#records-head").innerHTML = `<tr>${config.columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("")}<th>ACTIONS</th></tr>`;
  $("#records-body").innerHTML = records.map((record) => {
    const cells = config.columns.map(([key]) => {
      let text = displayRecordValue(resource, key, record);
      if (key === "fullName") {
        const initials = text.split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
        text = `<span class="student-cell"><span class="student-mini">${escapeHtml(initials)}</span>${escapeHtml(record.fullName)}</span>`;
      } else text = escapeHtml(text);
      return `<td>${text}</td>`;
    }).join("");
    return `<tr>${cells}<td><div class="row-actions"><button class="action-button" data-action="edit" data-id="${escapeHtml(record._id)}">Edit</button><button class="action-button delete" data-action="delete" data-id="${escapeHtml(record._id)}">Delete</button></div></td></tr>`;
  }).join("");
  $("#record-total").textContent = records.length;
  $("#empty-state").hidden = records.length !== 0;
  $(".records-table-wrap").hidden = records.length === 0;
}

// Show the selected administrator page and update its title and active navigation item.
function navigate(view) {
  state.currentView = view;
  const recordResource = Boolean(configurations[view]);
  $("#overview-view").hidden = view !== "overview";
  $("#records-view").hidden = !recordResource;
  $("#registrations-view").hidden = view !== "registrations";
  $("#results-view").hidden = view !== "results";
  document.querySelectorAll(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  const labels = { overview: "Overview", registrations: "Registrations", results: "Results" };
  $("#breadcrumb-current").textContent = recordResource ? configurations[view].title : labels[view];
  if (recordResource) {
    $("#records-title").textContent = configurations[view].title;
    $("#records-description").textContent = configurations[view].description;
    $("#add-record").textContent = `＋ Add ${configurations[view].singular}`;
    $("#search-input").value = "";
    renderRecords(view);
  }
  if (view === "registrations") renderRegistrations();
  if (view === "results") renderResultsStudents();
}

// Build dropdown options; program dropdowns use the current MongoDB program records.
function fieldOptions(field, currentValue) {
  let options = field.options || [];
  if (field.type === "course") options = state.records.courses.map((course) => ({
    value: course.courseCode, label: `${course.courseName} · ${course.department}`
  }));
  const optionHtml = options.map((option) => {
    const item = typeof option === "string" ? { value: option, label: option } : option;
    return `<option value="${escapeHtml(item.value)}" ${String(item.value) === String(currentValue ?? "") ? "selected" : ""}>${escapeHtml(item.label)}</option>`;
  }).join("");
  return `<option value="">${field.type === "course" ? "Select a program" : "Select an option"}</option>${optionHtml}`;
}

// Generate the add/edit form from the resource configuration and current record.
function openRecordForm(resource, record = null) {
  state.formResource = resource;
  state.editingId = record?._id || null;
  const config = configurations[resource];
  $("#modal-title").textContent = `${record ? "Edit" : "Add"} ${config.singular}`;
  $("#modal-description").textContent = record
    ? "Update the details below. Leave password blank to keep the current password."
    : "Complete the fields below to save this record.";
  $("#save-button").textContent = record ? "Save changes" : "Save record";
  $("#form-error").textContent = "";
  $("#form-fields").innerHTML = config.fields.map((field) => {
    const value = record?.[field.key] ?? "";
    const select = field.type === "select" || field.type === "course";
    const type = select ? "select" : (field.type || "text");
    const optional = record && field.optionalEdit;
    const input = select
      ? `<select id="field-${field.key}" name="${field.key}" required>${fieldOptions(field, value)}</select>`
      : `<input id="field-${field.key}" name="${field.key}" type="${type}" value="${type === "password" ? "" : escapeHtml(value)}" placeholder="${escapeHtml(field.placeholder || "")}" ${field.min !== undefined ? `min="${field.min}"` : ""} ${field.max !== undefined ? `max="${field.max}"` : ""} ${optional ? "" : "required"}>`;
    return `<div class="form-field"><label for="field-${field.key}">${escapeHtml(field.label)}${optional ? " (leave blank to keep current)" : ""}</label>${input}</div>`;
  }).join("");
  $("#modal-backdrop").hidden = false;
  $("#form-fields input, #form-fields select")?.focus();
}

// Hide and reset the shared add/edit dialog.
function closeRecordForm() {
  $("#modal-backdrop").hidden = true;
  $("#record-form").reset();
  state.formResource = null;
  state.editingId = null;
}

function studentProgramUnits(student) {
  return state.records.courseUnits.filter((unit) => unit.courseCode === student.courseCode);
}

// Display each student's registration state and unit names for all six semesters.
function renderRegistrations() {
  const query = $("#registration-search").value.trim().toLowerCase();
  const students = state.registrationOverview.filter((student) =>
    `${student.fullName} ${student.studentId} ${student.courseName || programName(student.courseCode)} ${student.department}`.toLowerCase().includes(query)
  );
  $("#registration-total").textContent = students.length;
  $("#registration-empty").hidden = state.registrationOverview.length !== 0;
  $("#registration-body").innerHTML = students.map((student) => {
    const status = student.semesters.map((semester) => {
      const registrations = state.records.registrations.filter((registration) =>
        registration.studentId === student.studentId && Number(registration.semester) === semester.semester
      );
      const names = registrations.map((registration) => unitById(registration.courseUnitId))
        .filter(Boolean)
        .map((unit) => `${unit.unitCode} ${unit.unitName}`);
      const stateLabel = names.length
        ? `${semester.locked ? "Graded · " : ""}${names.join(", ")}`
        : "Not registered";
      const style = semester.locked ? "semester-chip graded" : semester.registered ? "semester-chip registered" : "semester-chip";
      return `<span class="${style}" title="${escapeHtml(stateLabel)}">S${semester.semester}: ${escapeHtml(stateLabel)}</span>`;
    }).join("");
    return `<tr><td><span class="student-cell">${escapeHtml(student.fullName)}</span><small class="row-secondary">${escapeHtml(student.studentId)}</small></td><td>${escapeHtml(programName(student.courseCode))}<small class="row-secondary">${escapeHtml(student.department)}</small></td><td><div class="semester-chips">${status}</div></td><td><button class="action-button register-button" data-register="${escapeHtml(student.studentId)}">Register</button></td></tr>`;
  }).join("");
}

// Prepare the semester-registration dialog for the selected student.
function openRegistration(studentId) {
  const student = state.records.students.find((record) => record.studentId === studentId);
  if (!student) return;
  state.registeringStudent = student;
  $("#registration-student-name").textContent = `${student.fullName} · ${programName(student.courseCode)}`;
  const summary = state.registrationOverview.find((record) => record.studentId === studentId);
  $("#register-semester").innerHTML = (summary?.semesters || []).map((semester) =>
    `<option value="${semester.semester}" ${semester.locked ? "disabled" : ""}>Semester ${semester.semester}${semester.locked ? " · marks recorded" : ""}</option>`
  ).join("");
  $("#register-year").value = student.academicYear || "";
  $("#registration-error").textContent = "";
  renderUnitChecklist();
  $("#registration-modal").hidden = false;
}

// Show units for the selected program and semester, marking units already registered.
function renderUnitChecklist() {
  const student = state.registeringStudent;
  if (!student) return;
  const semester = Number($("#register-semester").value || 1);
  const units = studentProgramUnits(student).filter((unit) => Number(unit.semester) === semester);
  const registrations = state.records.registrations.filter((registration) =>
    registration.studentId === student.studentId && Number(registration.semester) === semester
  );
  const registeredUnitIds = new Set(registrations.map((registration) => String(registration.courseUnitId)));
  $("#unit-checklist").innerHTML = units.length ? units.map((unit) => {
    const registered = registeredUnitIds.has(unit._id);
    return `<label class="unit-option ${registered ? "already-registered" : ""}"><input type="checkbox" checked disabled><span><strong>${escapeHtml(unit.unitCode)} · ${escapeHtml(unit.unitName)}</strong><small>${escapeHtml(unit.creditUnits)} credit units${registered ? " · Already registered" : ""}</small></span></label>`;
  }).join("") : `<div class="curriculum-empty">No course units have been added to ${escapeHtml(programName(student.courseCode))}, semester ${semester} yet.</div>`;
}

// Calculate the credit-weighted GPA for a set of results.
function gpaFor(results) {
  let credits = 0;
  let points = 0;
  for (const result of results) {
    const unit = unitById(registrationById(result.registrationId)?.courseUnitId);
    const creditUnits = Number(unit?.creditUnits || result.creditUnits || 0);
    credits += creditUnits;
    points += Number(result.gradePoints || 0) * creditUnits;
  }
  return credits ? (points / credits).toFixed(2) : "—";
}

// Summarize each student with completed semesters and their current CGPA.
function renderResultsStudents() {
  const query = $("#results-search").value.trim().toLowerCase();
  const students = state.records.students.filter((student) =>
    `${student.fullName} ${student.studentId} ${student.department} ${programName(student.courseCode)}`.toLowerCase().includes(query)
  );
  $("#results-student-total").textContent = students.length;
  $("#results-empty").hidden = state.records.students.length !== 0;
  $("#results-students-body").innerHTML = students.map((student) => {
    const results = state.records.results.filter((result) => result.studentId === student.studentId);
    const registrations = state.records.registrations.filter((registration) => registration.studentId === student.studentId);
    const finished = Array.from({ length: 6 }, (_, index) => index + 1).filter((semester) => {
      const registered = registrations.filter((record) => Number(record.semester) === semester);
      const graded = results.filter((result) => Number(result.semester) === semester);
      return registered.length > 0 && graded.length >= registered.length;
    }).length;
    const cgpa = gpaFor(results);
    return `<tr><td><span class="student-cell">${escapeHtml(student.fullName)}</span><small class="row-secondary">${escapeHtml(student.studentId)}</small></td><td>${escapeHtml(student.department)}<small class="row-secondary">${escapeHtml(programName(student.courseCode))}</small></td><td>${finished} / 6</td><td><strong class="cgpa-value">${cgpa === "—" ? "—" : `${cgpa} / 5`}</strong></td><td><button class="action-button" data-student-details="${escapeHtml(student.studentId)}">More details</button></td></tr>`;
  }).join("");
}

// Build a semester-by-semester transcript, with controls to edit existing grades.
function openStudentDetails(studentId) {
  const student = state.records.students.find((record) => record.studentId === studentId);
  if (!student) return;
  const results = state.records.results.filter((result) => result.studentId === studentId);
  $("#details-title").textContent = `${student.fullName} · Transcript`;
  $("#details-content").innerHTML = Array.from({ length: 6 }, (_, index) => index + 1).map((semester) => {
    const semesterResults = results.filter((result) => Number(result.semester) === semester);
    return `<section class="transcript-semester"><div class="transcript-heading"><h3>Semester ${semester}</h3><strong>GPA: ${gpaFor(semesterResults)} / 5</strong></div>${semesterResults.length ? `<div class="table-wrap"><table><thead><tr><th>COURSE UNIT</th><th>CREDITS</th><th>GRADE</th><th>POINTS</th><th></th></tr></thead><tbody>${semesterResults.map((result) => {
      const registration = registrationById(result.registrationId);
      const unit = unitById(registration?.courseUnitId);
      return `<tr><td>${escapeHtml(unit?.unitName || result.courseName || "Course unit")}<small class="row-secondary">${escapeHtml(unit?.unitCode || result.courseUnitCode || "")}</small></td><td>${escapeHtml(unit?.creditUnits || result.creditUnits || 0)}</td><td><span class="grade-badge">${escapeHtml(result.grade)}</span></td><td>${escapeHtml(result.gradePoints)}</td><td><button class="action-button" data-edit-result="${escapeHtml(result._id)}">Edit grade</button></td></tr>`;
    }).join("")}</tbody></table></div>` : `<p class="no-semester-results">No results recorded for this semester yet.</p>`}</section>`;
  }).join("");
  $("#student-details-modal").hidden = false;
}

// Let the administrator select an ungraded registration before entering its grade.
function openResultForm(registration = null) {
  state.formResource = "results";
  state.editingId = null;
  const existingResults = new Set(state.records.results.map((result) => String(result.registrationId)));
  const eligible = state.records.registrations.filter((record) => !existingResults.has(record._id));
  $("#modal-title").textContent = "Add student result";
  $("#modal-description").textContent = "Choose a registered student course. Course unit, semester, and credits are filled from registration.";
  $("#save-button").textContent = "Save result";
  $("#form-error").textContent = "";
  const selected = registration?.registrationId || "";
  const options = eligible.map((record) => {
    const student = state.records.students.find((item) => item.studentId === record.studentId);
    const unit = unitById(record.courseUnitId);
    return `<option value="${escapeHtml(record._id)}" ${record._id === selected ? "selected" : ""}>${escapeHtml(student?.fullName || record.studentId)} · ${escapeHtml(unit?.unitCode || "")} ${escapeHtml(unit?.unitName || "")} · S${record.semester}</option>`;
  }).join("");
  $("#form-fields").innerHTML = `<div class="form-field full-width"><label for="field-registrationId">Registered student / course</label><select name="registrationId" id="field-registrationId" required><option value="">Select a registered course</option>${options}</select></div><div class="form-field full-width"><div id="result-unit-summary" class="result-unit-summary">Choose a registration to display its course and semester.</div></div><div class="form-field"><label for="field-grade">Student grade</label><select name="grade" id="field-grade" required><option value="">Select grade</option>${["A", "B", "C", "D", "E", "F"].map((grade) => `<option value="${grade}">${grade} · ${5 - ["A", "B", "C", "D", "E", "F"].indexOf(grade)} points</option>`).join("")}</select></div>`;
  $("#modal-backdrop").hidden = false;
  $("#field-registrationId").addEventListener("change", renderSelectedUnit);
  renderSelectedUnit();
}

// Display course, student, semester, and credit information for the chosen registration.
function renderSelectedUnit() {
  const record = registrationById($("#field-registrationId")?.value);
  const unit = record && unitById(record.courseUnitId);
  const student = record && state.records.students.find((item) => item.studentId === record.studentId);
  $("#result-unit-summary").textContent = record
    ? `${student?.fullName || record.studentId} · ${unit?.unitCode || ""} ${unit?.unitName || ""} · Semester ${record.semester} · ${unit?.creditUnits || 0} credit units`
    : "Choose a registration to display its course and semester.";
}

// Fill the student-only page using progress data returned for the signed-in student.
function renderStudentPortal(progress) {
  const student = progress.student;
  $("#student-welcome").textContent = `Welcome, ${student.fullName}`;
  $("#student-top-name").textContent = student.studentId;
  $("#student-course").textContent = `${student.courseName || programName(student.courseCode)} · ${student.department}`;
  $("#student-cgpa").textContent = progress.cgpa === null ? "—" : `${progress.cgpa} / 5`;
  $("#student-semesters").textContent = `${progress.semestersFinished} / 6`;
  $("#student-completion").textContent = `${progress.completionPercent}%`;
  $("#completion-bar").style.width = `${Math.min(progress.completionPercent, 100)}%`;
  $("#student-credits").textContent = progress.completedCredits;
  $("#student-total-credits").textContent = `of ${progress.totalCredits} curriculum credit units`;
  $("#student-semester-details").innerHTML = progress.semesters.map((semester) =>
    `<section class="transcript-semester"><div class="transcript-heading"><h3>Semester ${semester.semester}</h3><strong>${semester.finished ? "Completed" : semester.registeredUnits ? "In progress" : "Not registered"} · GPA: ${semester.gpa ?? "—"} / 5</strong></div>${semester.results.length ? `<div class="table-wrap"><table><thead><tr><th>COURSE UNIT</th><th>CREDITS</th><th>GRADE</th><th>POINTS</th></tr></thead><tbody>${semester.results.map((result) => `<tr><td>${escapeHtml(result.courseUnitName)}<small class="row-secondary">${escapeHtml(result.courseUnitCode)}</small></td><td>${escapeHtml(result.creditUnits)}</td><td><span class="grade-badge">${escapeHtml(result.grade)}</span></td><td>${escapeHtml(result.gradePoints)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="no-semester-results">${semester.registeredUnits ? "Grades are not available yet." : "No results recorded for this semester."}</p>`}</section>`
  ).join("");
  drawPerformanceChart(progress.semesters);
}

// Draw a small dependency-free GPA line chart on the HTML canvas.
function drawPerformanceChart(semesters) {
  const canvas = $("#performance-chart");
  const context = canvas.getContext("2d");
  const width = Math.max(canvas.clientWidth, 300);
  const height = 220;
  const scale = window.devicePixelRatio || 1;
  canvas.width = width * scale;
  canvas.height = height * scale;
  context.scale(scale, scale);
  context.clearRect(0, 0, width, height);
  const left = 38;
  const right = 18;
  const top = 14;
  const bottom = 32;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  context.font = "10px DM Sans, sans-serif";
  context.textAlign = "right";
  for (let point = 0; point <= 5; point++) {
    const y = top + chartHeight * (1 - point / 5);
    context.strokeStyle = "#ececf2";
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(width - right, y);
    context.stroke();
    context.fillStyle = "#a0a0b0";
    context.fillText(String(point), left - 10, y + 3);
  }
  const values = semesters.map((semester) => semester.gpa);
  const points = values.map((value, index) => ({
    x: left + (chartWidth * index) / Math.max(values.length - 1, 1),
    y: top + chartHeight * (1 - (value ?? 0) / 5),
    value
  }));
  context.strokeStyle = "#6d5de7";
  context.lineWidth = 2.5;
  context.beginPath();
  let started = false;
  for (const point of points) {
    if (point.value === null) { started = false; continue; }
    if (started) context.lineTo(point.x, point.y);
    else { context.moveTo(point.x, point.y); started = true; }
  }
  context.stroke();
  points.forEach((point, index) => {
    const x = left + (chartWidth * index) / Math.max(values.length - 1, 1);
    context.fillStyle = "#a0a0b0";
    context.textAlign = "center";
    context.fillText(`S${index + 1}`, x, height - 8);
    if (point.value !== null) {
      context.fillStyle = "#fff";
      context.beginPath();
      context.arc(point.x, point.y, 5, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#6d5de7";
      context.lineWidth = 2;
      context.stroke();
    }
  });
  if (!values.some((value) => value !== null)) {
    context.fillStyle = "#9999aa";
    context.textAlign = "center";
    context.fillText("Semester GPA will appear when results are recorded.", width / 2, height / 2);
  }
}

// Load all admin collections together so tables and dropdowns use the same data.
async function loadAdminData() {
  const resources = ["students", "courses", "courseUnits", "registrations", "results"];
  const values = await Promise.all(resources.map((resource) => request(`/api/${resource}`)));
  resources.forEach((resource, index) => { state.records[resource] = values[index]; });
  state.registrationOverview = await request("/api/registration-overview");
  document.querySelector(".database-status strong").textContent = "Database connected";
  document.querySelector(".database-status small").textContent = "MongoDB · Live";
  document.querySelector(".status-dot").style.background = "#36bf81";
  renderOverview();
  if (configurations[state.currentView]) renderRecords(state.currentView);
  if (state.currentView === "registrations") renderRegistrations();
  if (state.currentView === "results") renderResultsStudents();
}

// Open the appropriate portal and fetch its role-specific data after sign-in.
async function showUser(user) {
  state.user = user;
  if (user.role === "admin") {
    setScreen("admin");
    $("#admin-name").textContent = user.username;
    await loadAdminData();
  } else {
    setScreen("student");
    const progress = await request("/api/student/progress");
    renderStudentPortal(progress);
  }
}

// Restore an existing login session when the page is opened or refreshed.
async function initialize() {
  setToday();
  setLoginRole("student");
  try {
    const { user } = await request("/api/auth/me");
    await showUser(user);
  } catch {
    setScreen("login");
  }
}

// Connect forms, navigation, dialogs, and table buttons to their actions/API calls.
function bindEvents() {
  document.querySelectorAll(".login-tab").forEach((tab) => tab.addEventListener("click", () => setLoginRole(tab.dataset.loginRole)));
  $("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("#login-error").textContent = "";
    const submit = $("#login-submit");
    submit.disabled = true;
    submit.textContent = "Signing in…";
    try {
      const { user } = await request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ role: state.role, identifier: $("#login-identifier").value.trim(), password: $("#login-password").value })
      });
      await showUser(user);
    } catch (error) {
      $("#login-error").textContent = error.message;
    } finally {
      submit.disabled = false;
      submit.textContent = "Sign in";
    }
  });

  document.querySelectorAll("[data-logout]").forEach((button) => button.addEventListener("click", async () => {
    try {
      await request("/api/auth/logout", { method: "POST" });
      state.user = null;
      $("#login-form").reset();
      setScreen("login");
    } catch (error) {
      toast(error.message, true);
    }
  }));
  document.querySelectorAll(".nav-link").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.view)));
  $("#quick-add").addEventListener("click", () => openRecordForm("students"));
  $("#add-record").addEventListener("click", () => openRecordForm(state.currentView));
  $("#empty-add").addEventListener("click", () => openRecordForm(state.currentView));
  $("#search-input").addEventListener("input", () => renderRecords(state.currentView));
  $("#registration-search").addEventListener("input", renderRegistrations);
  $("#results-search").addEventListener("input", renderResultsStudents);
  $("#records-body").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const resource = state.currentView;
    const record = state.records[resource].find((item) => item._id === button.dataset.id);
    if (!record) return;
    if (button.dataset.action === "edit") return openRecordForm(resource, record);
    if (!window.confirm(`Delete this ${configurations[resource].singular}? This action cannot be undone.`)) return;
    try {
      await request(`/api/${resource}/${record._id}`, { method: "DELETE" });
      await loadAdminData();
      toast(`${configurations[resource].singular} deleted.`);
    } catch (error) { toast(error.message, true); }
  });

  $("#record-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const resource = state.formResource;
    const isEditing = Boolean(state.editingId);
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    for (const field of configurations[resource]?.fields || []) {
      if (field.type === "number") data[field.key] = Number(data[field.key]);
    }
    const button = $("#save-button");
    button.disabled = true;
    button.textContent = "Saving…";
    $("#form-error").textContent = "";
    try {
      const endpoint = `/api/${resource}${state.editingId ? `/${state.editingId}` : ""}`;
      await request(endpoint, { method: state.editingId ? "PUT" : "POST", body: JSON.stringify(data) });
      closeRecordForm();
      await loadAdminData();
      toast(`${resource === "results" ? "Result" : configurations[resource].singular} ${resource === "results" || !isEditing ? "added" : "updated"} successfully.`);
    } catch (error) { $("#form-error").textContent = error.message; }
    finally {
      button.disabled = false;
      button.textContent = isEditing ? "Save changes" : resource === "results" ? "Save result" : "Save record";
    }
  });
  $("#add-result").addEventListener("click", () => openResultForm());
  $("#results-students-body").addEventListener("click", (event) => {
    const button = event.target.closest("[data-student-details]");
    if (button) openStudentDetails(button.dataset.studentDetails);
  });
  $("#details-content").addEventListener("click", (event) => {
    const button = event.target.closest("[data-edit-result]");
    if (!button) return;
    const result = state.records.results.find((item) => item._id === button.dataset.editResult);
    if (!result) return;
    $("#student-details-modal").hidden = true;
    state.formResource = "results";
    state.editingId = result._id;
    $("#modal-title").textContent = `Edit grade · ${result.studentName}`;
    $("#modal-description").textContent = `${result.courseName} · Semester ${result.semester}`;
    $("#save-button").textContent = "Save grade";
    $("#form-error").textContent = "";
    $("#form-fields").innerHTML = `<div class="form-field full-width"><div class="result-unit-summary">${escapeHtml(result.studentName)} · ${escapeHtml(result.courseUnitCode)} ${escapeHtml(result.courseName)} · Semester ${escapeHtml(result.semester)}</div></div><div class="form-field"><label for="field-grade">Grade</label><select id="field-grade" name="grade" required>${["A", "B", "C", "D", "E", "F"].map((grade) => `<option value="${grade}" ${grade === result.grade ? "selected" : ""}>${grade} · ${5 - ["A", "B", "C", "D", "E", "F"].indexOf(grade)} points</option>`).join("")}</select></div>`;
    $("#modal-backdrop").hidden = false;
  });

  $("#registration-body").addEventListener("click", (event) => {
    const button = event.target.closest("[data-register]");
    if (button) openRegistration(button.dataset.register);
  });
  $("#register-semester").addEventListener("change", renderUnitChecklist);
  $("#registration-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.registeringStudent) return;
    const button = $("#confirm-registration");
    button.disabled = true;
    $("#registration-error").textContent = "";
    try {
      const response = await request("/api/registrations/batch", {
        method: "POST",
        body: JSON.stringify({
          studentId: state.registeringStudent.studentId,
          semester: Number($("#register-semester").value),
          academicYear: $("#register-year").value.trim()
        })
      });
      $("#registration-modal").hidden = true;
      await loadAdminData();
      toast(`${response.registered} course unit${response.registered === 1 ? "" : "s"} registered.`);
    } catch (error) { $("#registration-error").textContent = error.message; }
    finally { button.disabled = false; }
  });

  document.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", closeRecordForm));
  document.querySelectorAll("[data-close-registration]").forEach((button) => button.addEventListener("click", () => { $("#registration-modal").hidden = true; }));
  document.querySelectorAll("[data-close-details]").forEach((button) => button.addEventListener("click", () => { $("#student-details-modal").hidden = true; }));
  window.addEventListener("resize", () => { if (!$("#student-app").hidden) request("/api/student/progress").then(renderStudentPortal).catch((error) => toast(error.message, true)); });
}

bindEvents();
initialize().catch((error) => {
  setScreen("login");
  $("#login-error").textContent = `Could not load portal: ${error.message}`;
});
