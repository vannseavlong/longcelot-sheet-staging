# longcelot-sheet-db — Developer Guide

---

## 1. Installation

```
pnpm add longcelot-sheet-db
```

---

## 2. Project Setup

Initialize the project:

```
pnpm sheet-db init
```

Creates:

* sheet-db.config.ts
* schemas folder
* environment configuration

---

## 3. Define Schemas

Create a table definition:

```ts
import { defineTable, string, date } from "longcelot-sheet-db";

export default defineTable({
  name: "bookings",
  actor: "user",
  columns: {
    service: string().required(),
    date: date(),
    status: string().default("pending")
  }
});
```

---

## 4. Sync Schema to Sheets

```
pnpm sheet-db sync
```

This creates or updates tables in Google Sheets.

Existing data is never deleted.

---

## 5. Configure Adapter

```ts
import { createSheetAdapter } from "longcelot-sheet-db";

const sheetDB = createSheetAdapter({
  schemas: "./schemas",
  adminSheetId: process.env.ADMIN_SHEET_ID
});
```

---

## 6. Inject Runtime Context

Provide identity information per request:

```ts
const db = sheetDB.withContext({
  userId: "user_123",
  role: "user"
});
```

This enables:

* role routing
* permission checks
* sheet resolution

---

## 7. Perform CRUD Operations

### Create

```
db.table("bookings").create(data)
```

### Read

```
db.table("bookings").findMany()
```

### Update

```
db.table("bookings").update()
```

### Delete

```
db.table("bookings").delete()
```

---

## 8. Validation Rules

Columns support:

* required values
* default values
* uniqueness
* enums
* min/max
* regex validation

Invalid writes throw errors.

---

## 9. Recommended Project Structure

```
schemas/
  user/
  admin/
  seller/
```

Organize schemas by actor.

---

## 10. Best Practices

* keep schemas simple
* use actors consistently
* avoid large datasets
* treat as staging environment
* design with future migration in mind
