# Student Web App - longcelot-sheet-db Integration

This example demonstrates a complete Student Management System using `longcelot-sheet-db`.

## Architecture

The system has 4 actors:
- **admin**: System administrators managing users and school-wide data
- **student**: Students viewing their own academic data
- **teacher**: Teachers managing classes and grades
- **parent**: Parents viewing their children's information

## Data Model

### Admin Tables
- `users`: Central user registry
- `credentials`: Authentication credentials
- `classes`: Class definitions
- `student_teacher_map`: Student-teacher relationships
- `parent_student_map`: Parent-child relationships
- `school_calendar`: Important dates
- `announcements`: School-wide announcements

### Student Tables (per student)
- `profile`: Student personal information
- `attendance`: Attendance records
- `timetable`: Class schedule
- `assignments`: Assignment tracking
- `grades`: Academic grades
- `notices`: Student-specific notices

### Teacher Tables (per teacher)
- `profile`: Teacher information
- `materials`: Teaching materials
- `assignment_templates`: Assignment templates
- `feedback`: Student feedback

### Parent Tables (per parent)
- `children`: List of children
- `attendance_summary`: Attendance overview
- `grade_summary`: Academic performance overview
- `notices`: Parent notifications

## Setup

1. Initialize the project:
```bash
cd examples/student-app
pnpm sheet-db init
```

2. Generate admin sheet ID:
   - Create a Google Sheet manually
   - Share it with your service account
   - Copy the sheet ID to `.env`

3. Sync schemas:
```bash
pnpm sheet-db sync
```

4. Run the example:
```bash
pnpm dev
```

## Key Features

- Actor-based data isolation
- Google OAuth authentication
- Role-based permissions
- Automatic sheet creation per user
- Type-safe schema definitions
