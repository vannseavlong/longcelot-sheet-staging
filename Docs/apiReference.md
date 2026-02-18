# longcelot-sheet-db — API Reference

---

## createSheetAdapter(options)

Creates the adapter instance.

### Parameters

| Option       | Description               |
| ------------ | ------------------------- |
| schemas      | Path to schema directory  |
| adminSheetId | Central registry sheet ID |

### Example

```ts
createSheetAdapter({ schemas, adminSheetId })
```

---

## sheetDB.withContext(context)

Injects runtime identity.

### Parameters

| Field  | Description      |
| ------ | ---------------- |
| userId | actor identifier |
| role   | actor role       |

Returns a scoped database instance.

---

## db.table(name)

Returns table interface.

### Methods

---

### create(data)

Inserts new record.

* applies defaults
* validates schema
* generates metadata fields

---

### findMany(query)

Returns matching records.

---

### update(options)

Updates matching rows.

---

### delete(options)

Deletes rows (hard or soft).

---

## Schema DSL

### defineTable(config)

Defines table schema.

Required:

* name
* actor
* columns

---

### Column Builders

* string()
* number()
* boolean()
* date()
* json()

---

### Modifiers

* required()
* unique()
* default(value)
* enum(values)
* min(n)
* max(n)
* pattern(regex)
* readonly()

---

## Errors

The adapter may throw:

* validation errors
* permission errors
* configuration errors
* schema errors
