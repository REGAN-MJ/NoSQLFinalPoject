# University Academic Results Portal

A university academic portal built with HTML, CSS, JavaScript, Express, and MongoDB. Administrators manage programs, students, semester registrations, course units, and grades. Students sign in to view only their own academic record and progress analytics.

## Requirements and setup

- Node.js 18 or newer
- MongoDB locally, or a MongoDB Atlas connection string

Install dependencies with `npm install`. Copy `.env.example` to `.env`, configure `MONGODB_URI`, then run:

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000). For development, run `npm run dev`.

The application seeds the four requested programs the first time it connects:

- Software Engineering — COMPUTING & INFORMATICS
- Computer Science — COMPUTING & INFORMATICS
- Business Administration — BUSINESS SCHOOL
- Human Resource Management — BUSINESS SCHOOL

The application seeds a suggested demo curriculum of three course units per semester for all four programs (semesters 1–6). These are sample units for demonstration only, not official university curricula. You can edit or add units under **Course units**. On startup, demo units are only inserted for program/semester combinations that have no units, so existing customized curricula are preserved.

## Sign-in

- **Administrator:** username `Admin`, password `Admin123` by default. Override with `ADMIN_USERNAME` and `ADMIN_PASSWORD`.
- **Student:** registration number or email address and the password assigned when the student record is created. Student passwords are stored as bcrypt hashes.

Configure a strong `SESSION_SECRET` for deployments. The built-in in-memory session store is intended for local/student-project use; production deployments should use a persistent session store and HTTPS.

## Academic records

- **Programs (`courses`):** program code, name, and department. A student's `courseCode` points to a program. The department is copied onto the student record from the selected program.
- **Students (`students`):** registration number (`studentId`), name, program code, academic year, email, gender, department, and bcrypt password hash.
- **Course units (`courseUnits`):** unit code and name, program code, semester (1–6), and credit units.
- **Registrations (`registrations`):** student registration number, program code, course unit's MongoDB `_id`, academic year, and semester. A registration links one student to one course unit.
- **Results (`results`):** registration's MongoDB `_id`, student registration number, grade, grade points, academic year, and semester. Grades map to a five-point scale: A=5, B=4, C=3, D=2, E=1, F=0. GPA and CGPA are credit-weighted.

MongoDB creates an `_id` for each document. References between collections are stored as IDs or program/student codes; the application looks up related documents when presenting names and reports.

## Database workflow

### 1. Application startup and seed data

1. The server reads `MONGODB_URI` and `DB_NAME` from `.env`, connects to MongoDB, and uses the `student_academic_records` database by default.
2. It creates unique indexes for student registration numbers and email addresses, program codes, and each program's course-unit codes. It also creates indexes to prevent duplicate student/course-unit/semester registrations and duplicate results for one registration.
3. The four demo programs are inserted if their program codes do not already exist.
4. For each program and semester, the three-course-unit demo curriculum is inserted only when that program/semester currently has **no** course units. If you have customized a semester, startup leaves its units as they are.

The sample curricula are for demonstrating the workflow, not official degree requirements. Back up your database before changing or removing curriculum data.

### 2. Configure programs and course units (administrator)

Sign in as the administrator and open **Programs** or **Course units**:

1. Create or edit a program with its name, unique code, and department.
2. Create course units by selecting a program, entering a unique unit code and name, choosing semester 1–6, and setting credit units.
3. Students choose a program rather than entering a department manually. The server reads that program and assigns its department when it saves the student.

Do not change a program code after students or units refer to it. Do not change the program, semester, or credit value of a course unit after it has registrations.

### 3. Add a student

The administrator enters the student's registration number, name, program, academic year, email, gender, and password. The server normalizes the registration number and email, checks the required fields, verifies the program exists, and hashes the password with bcrypt before storing the student. The plain password is never returned by the API or stored in MongoDB.

Unique indexes reject duplicate registration numbers and email addresses. If the student changes program before registration, the department is updated from the newly selected program.

### 4. Register a semester

From **Registrations**, choose a student and semester. The portal lists the course units configured for the student's program and that semester. Confirming registration creates one registration document for each unit, linked to the student and unit and tagged with the academic year.

The API rejects a semester with no configured units, duplicate registrations, or a semester where a result has already been entered. Once a result exists, that semester cannot be re-registered or modified through the registration workflow. The registration list shows the unit names and whether each semester is not registered, registered, or graded.

### 5. Enter or edit grades

From **Results**, select a registered student/course unit and choose a grade. The server gets the student, unit, semester, academic year, and credit value from the registration and curriculum; those values are not trusted from the browser. It saves the grade and corresponding grade points. Only one result can exist per registration. An administrator can later edit the grade; the stored grade points are recalculated at the same time.

### 6. Calculate and view academic progress

The results page groups records by student and semester. A semester counts as finished when every registered course unit for that semester has a result. Semester GPA is the sum of `grade points × credit units` divided by the total credit units with results in that semester. CGPA uses the same weighted calculation over all of the student's recorded results, including failed attempts. The student portal shows that student's own grades, semester GPAs, CGPA, earned credits, completion progress, and a semester-performance chart.

Completion progress counts course units with a passing grade (A–E) against the units configured for the student's program. An F result remains visible and contributes zero grade points, but does not count as a completed course unit.

### 7. Data relationships and deletion

```text
courses (program)
  ├── students.courseCode
  └── courseUnits.courseCode
        └── registrations.courseUnitId ── registrations.studentId → students.studentId
              └── results.registrationId
```

The server blocks deleting students that have registrations, programs that still have students or units, and course units that have registrations. These checks protect the linked academic history from being orphaned. Deleting a result leaves its registration in place, allowing an administrator to enter a replacement grade for that registered course.

### 8. Login and access control

Login creates a server-side session. Student sessions are associated with one registration number; the student progress endpoint always uses that session identity, so a student cannot choose another student's ID in the request. Administrative CRUD and reporting endpoints require an administrator session. Sign out destroys the session.

For production, configure a strong `SESSION_SECRET`, change the default admin credentials, use HTTPS, and replace Express's development in-memory session store with a persistent session store.

## API overview

Authentication endpoints: `POST /api/auth/login`, `GET /api/auth/me`, and `POST /api/auth/logout`.

Administrator endpoints support listing, creating, updating, and deleting students, programs, and course units under `/api/students`, `/api/courses`, and `/api/courseUnits`. Results can be listed at `/api/results`, created from a registration with `POST /api/results`, and edited with `PUT /api/results/:id`. `POST /api/registrations/batch` registers a student's semester, and `GET /api/registration-overview` provides the registration summary. Student accounts can access their own progress at `GET /api/student/progress`.
