

📦 longcelot-sheet-db
Google Sheets–backed Staging Database for Node.js

1. Purpose
longcelot-sheet-db is a Node.js library + CLI that allows developers to use Google Sheets as a staging database to reduce infrastructure cost during early development.
Instead of running MySQL, PostgreSQL, or MongoDB for staging:
Each user stores their data in their own Google Sheet
Admin/Super Admin maintain a single centralized registry sheet
Authentication is powered by Google OAuth
Optional email + password login using bcrypt
Developers define schemas that are automatically converted into sheet tables
This system is intended for:
MVPs
Prototypes
Internal tools
Staging environments
Not production.

2. Core Design Philosophy
Cost-first design
User owns their data
Simple conventions
Predictable structure
Security by default
If something feels fancy but unnecessary → we skip it.

3. What This Package Is
A library used inside Node.js backends
A CLI for schema generation & syncing

4. What This Package Is NOT
A replacement for production databases
A high-performance analytics engine
A real-time database

5. High-Level Architecture
Developer Backend
      |
      v
longcelot-sheet-db SDK
      |
      v
Google OAuth2  ---> Google Sheets API
      |
      v
Central Admin Sheet (Registry)
      |
      v
User-Owned Sheets (Per role)


6. Actors (Roles)
Every project must define actors.
Example:
admin
user
seller
Actors determine where tables live.

7. Sheet Placement Rules
Actor
Storage Location
admin
Central Admin Sheet
user
User-owned sheet
seller
Seller-owned sheet

Each actor owns exactly one sheet.

8. Central Admin Sheet (Registry)
One Google Sheet controlled by Super Admin.
8.1 users
| user_id | role | email | actor_sheet_id | created_at |

8.2 credentials
| user_id | password_hash | provider |
provider values:
oauth
local

8.3 actors
| actor | description |

8.4 permissions (optional)
| actor | permission_key |

9. User-Owned Sheet Structure
Each user sheet contains multiple tabs.
Example:
profile
bookings
payments
settings

Each tab = one table.

10. Schema Definition (Developer Side)
Developers define schemas in JS/TS.
defineTable({
  name: "bookings",
  actor: "user",
  columns: {
    booking_id: "string",
    service: "string",
    date: "date",
    status: "string"
  }
});


11. Data Type Mapping
Type
Sheet Representation
string
text
number
number
boolean
TRUE/FALSE
date
ISO string
json
JSON string


12. Schema → Sheet Convention
Sheet name = table name
First row = column names
One row = one record

13. CLI Features
Install:
pnpm add longcelot-sheet-db

Initialize project:
pnpm sheet-db init

Creates:
sheet-db.config.ts
schemas/


Generate Table
pnpm sheet-db generate bookings

Creates:
schemas/bookings.ts


Sync Schemas to Sheets
pnpm sheet-db sync

What it does:
Reads schemas
Creates missing sheets
Adds missing columns
Never deletes existing data

14. OAuth Configuration
Developers must provide:
Google Client ID
Google Client Secret
Redirect URI
Stored in env:
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
ADMIN_SHEET_ID=


15. Authentication Flow
15.1 Registration (First Time)
User signs in with Google OAuth
SDK creates Google Sheet in user's account
Sheet shared with admin/super admin
User inserted into central users table
If password provided → bcrypt hash stored

15.2 Login
Option A: Google OAuth
Option B: Email + Password
Password flow:
Fetch hash
bcrypt.compare()
Success → session token

16. Built-in Security
bcrypt hashing
OAuth tokens never stored in plain text
Sheets private by default
Role validation on every request

17. Library Usage
import { createSheetDB } from "longcelot-sheet-db";

const db = createSheetDB({
  adminSheetId: process.env.ADMIN_SHEET_ID
});


18. CRUD API
db.table("bookings").insert(data);
db.table("bookings").find({ status: "pending" });
db.table("bookings").update(id, data);
db.table("bookings").delete(id);


19. Row Identity
Every row automatically gets:
_id
_created_at
_updated_at


20. Error Handling
Missing sheet → auto create
Missing column → auto add
Permission denied → throw error

21. Recommended Project Structure
schemas/
  user/
  admin/
  seller/


22. Performance Expectations
Suitable for hundreds to low thousands of rows
Not suitable for millions

23. Example Use Cases
Booking system
Simple e-commerce
CRM prototype
Internal dashboards

24. Future Roadmap
- Prisma/SQL export CLI (`sheet-db export`)
- Cross-actor joins (`adapter.join()`)
- Developer mock user sheets (`sheet-db mock-users`)
- Bulk schema sync to all users (`sync --all-users`)
- Column encryption
- Audit logs
- Row-level permissions
- Advanced query operators (gt, lt, contains)
- Batch operations (bulkCreate, bulkUpdate)

25. Summary
longcelot-sheet-db gives developers a free, structured, secure staging database powered by Google Sheets, without forcing a specific production database.

26. Schema DSL (Definition Language)
The Schema DSL is a TypeScript-first API that defines:
Tables
Columns
Types
Validations
Defaults
Index behavior (lightweight)
It is declarative and framework-agnostic.

26.1 Basic Table Definition
import { defineTable } from "longcelot-sheet-db";

export default defineTable({
  name: "bookings",
  actor: "user",

  columns: {
    booking_id: string(),
    service: string(),
    date: date(),
    status: string()
  }
});


26.2 Column Builder API
Each column is created using a builder:
string()
number()
boolean()
date()
json()

These return a chainable object.

26.3 Column Options
string()
  .required()
  .unique()
  .default("pending")
  .min(3)
  .max(100)


26.4 Supported Modifiers
Modifier
Description
required()
Cannot be null
unique()
Enforced in sheet
default(value)
Applied on insert
min(n)
Min length / value
max(n)
Max length / value
enum([...])
Allowed values
pattern(regex)
Regex match
readonly()
Cannot be updated


26.5 Example With Validations
status: string()
  .enum(["pending", "paid", "cancelled"])
  .default("pending")


26.6 Primary Key
Every table automatically has:
_id

Developers may optionally define a logical primary key:
booking_id: string().primary()


26.7 Timestamps
Opt-in timestamps:
defineTable({
  name: "bookings",
  actor: "user",
  timestamps: true,
  columns: { ... }
});

Creates:
_created_at
_updated_at


26.8 Relations (Lightweight)
Relations are informational, not enforced joins.
user_id: string().ref("users._id")

Stored as plain string.

26.9 Index Hinting
Optional performance hint:
email: string().index()

Internally creates a lightweight lookup map sheet.

26.10 Soft Delete
softDelete: true

Adds:
_deleted_at


26.11 Full Table Example
export default defineTable({
  name: "users",
  actor: "admin",
  timestamps: true,

  columns: {
    email: string().required().unique(),
    role: string().enum(["admin","user"]),
    name: string().min(2),
    is_active: boolean().default(true)
  }
});


27. Runtime Schema Object
At runtime schemas become:
db.schema.users.columns.email.required === true

Used for:
Validation
Auto-defaults
CLI syncing

28. Validation Flow
On insert/update:
Apply defaults
Validate types
Validate rules
Write row
Failure → throw descriptive error.

29. CLI Command Design

29.1 Init
pnpm sheet-db init

Creates:
sheet-db.config.ts
schemas/
.env.example

Prompts:
Google Client ID
Google Secret
Admin Sheet ID

29.2 Generate Table
pnpm sheet-db generate bookings

Interactive prompts:
Actor
Columns
Types
Generates file.

29.3 Sync
pnpm sheet-db sync

Actions:
Create missing sheets
Add missing columns
Create index helper sheets
Never drop data

29.4 Validate Schemas
pnpm sheet-db validate

Checks:
Duplicate table names
Invalid modifiers
Unknown actors

29.5 Push Seed Data
pnpm sheet-db seed

Reads:
seeds/*.ts

Inserts starter rows.

29.6 Doctor
pnpm sheet-db doctor

Diagnostics:
OAuth working?
Sheet access OK?
Admin sheet reachable?

29.7 Status
pnpm sheet-db status

Shows:
Tables
Actors
Sheet IDs

30. sheet-db.config.ts
export default {
  projectName: "my-app",
  superAdminEmail: "admin@gmail.com",
  actors: ["admin","user","seller"]
};


31. Developer Experience Goal
A new dev should be able to:
pnpm add longcelot-sheet-db
pnpm sheet-db init
pnpm sheet-db generate users
pnpm sheet-db sync

And be productive in < 5 minutes.

32. Design Philosophy Recap
Explicit > implicit
Convention > configuration
Safety > cleverness



