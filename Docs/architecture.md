# longcelot-sheet-db — Architecture

---

## 1. System Overview

longcelot-sheet-db is a schema-first storage adapter that maps database-style operations to Google Sheets.

It provides:

* schema-driven table generation
* automatic CRUD mapping
* role-aware data routing
* validation and access control

The system acts as a pluggable storage engine for Node.js backends.

---

## 2. High-Level Architecture

```
Application Backend
       ↓
longcelot-sheet-db Adapter
       ↓
Google OAuth + Sheets API
       ↓
Central Registry Sheet
       ↓
Actor-Owned Sheets
```

The adapter manages storage behavior.
The application manages business logic.

---

## 3. Core Components

### 3.1 Adapter Runtime

Responsible for:

* schema loading
* CRUD mapping
* validation engine
* role routing
* permission enforcement
* context handling

---

### 3.2 CLI System

Manages structure and configuration.

Functions:

* project initialization
* schema generation
* sheet synchronization
* validation
* diagnostics

The CLI never handles runtime data operations.

---

### 3.3 Storage Layer

The storage layer consists of:

#### Central Admin Sheet

* registry of users
* actor definitions
* permissions
* sheet ownership mapping

#### User-Owned Sheets

* actor-specific storage
* tables represented as tabs
* structured records

---

## 4. Actor-Based Data Model

Actors represent roles that determine:

* data ownership
* sheet location
* access permissions

Each actor owns exactly one sheet.

---

## 5. Schema System

Schemas define:

* table structure
* column types
* validation rules
* defaults
* metadata behavior

At runtime schemas generate:

* sheet tables
* validation rules
* CRUD interfaces

---

## 6. Runtime Flow

### Startup

1. Load schema files
2. Validate schema definitions
3. Sync sheet structure
4. Generate CRUD adapters

---

### Request Flow

1. Application injects user context
2. Adapter resolves actor ownership
3. Adapter validates request
4. Operation mapped to Sheets API
5. Result returned to application

---

## 7. Storage Model

### Table Representation

* Sheet tab = table
* First row = column definitions
* Row = record

---

### Automatic Fields

Each record includes:

* `_id`
* `_created_at`
* `_updated_at`

Optional metadata fields may be enabled.

---

## 8. Validation Pipeline

Before persistence:

1. Apply defaults
2. Validate types
3. Enforce constraints
4. Write data

---

## 9. Security Model

* role-based access enforcement
* private sheet storage
* permission validation per request
* optional credential hashing

---

## 10. Design Constraints

The system is optimized for:

* small-to-medium datasets
* staging environments
* predictable structure
* low infrastructure cost

It is not designed for large-scale production workloads.
