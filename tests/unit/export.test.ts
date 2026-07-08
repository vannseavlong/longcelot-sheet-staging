import { generatePrismaModel, generateSQLTable } from '../../src/cli/commands/migrate';
import { defineTable } from '../../src/schema/defineTable';
import { string, number, boolean, date, json } from '../../src/schema/columnBuilder';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const simpleSchema = defineTable({
  name: 'users',
  actor: 'admin',
  columns: {
    user_id: string().primary(),
    email: string().required(),
    age: number(),
    active: boolean().default(true),
  },
});

const fkSchema = defineTable({
  name: 'posts',
  actor: 'user',
  columns: {
    post_id: string().primary(),
    author_id: string().required().ref('users.user_id'),
    title: string().required(),
    published_at: date(),
  },
});

const allTypesSchema = defineTable({
  name: 'metadata',
  actor: 'admin',
  columns: {
    meta_id: string().primary(),
    label: string().required(),
    count: number().required(),
    flag: boolean(),
    created: date(),
    payload: json(),
  },
});

const uniqueSchema = defineTable({
  name: 'profiles',
  actor: 'user',
  columns: {
    profile_id: string().primary(),
    username: string().required().unique(),
    bio: string(),
  },
});

// ── generatePrismaModel ───────────────────────────────────────────────────────

describe('generatePrismaModel()', () => {
  it('opens and closes a model block with the schema name', () => {
    const output = generatePrismaModel(simpleSchema);
    expect(output).toMatch(/^model users \{/);
    expect(output).toContain('}');
  });

  it('marks the pkColumn with @id', () => {
    const output = generatePrismaModel(simpleSchema);
    expect(output).toContain('@id');
    // user_id is the pk
    expect(output).toMatch(/user_id\s+String.*@id/);
  });

  it('adds @default(cuid()) for string PK', () => {
    const output = generatePrismaModel(simpleSchema);
    expect(output).toContain('@default(cuid())');
  });

  it('marks required columns as non-optional', () => {
    const output = generatePrismaModel(simpleSchema);
    // email is required → no '?' suffix
    expect(output).toMatch(/email\s+String[^?]/);
  });

  it('marks optional columns with ?', () => {
    const output = generatePrismaModel(simpleSchema);
    // age is optional
    expect(output).toMatch(/age\s+Float\?/);
  });

  it('adds @unique for unique columns', () => {
    const output = generatePrismaModel(uniqueSchema);
    expect(output).toContain('@unique');
    expect(output).toMatch(/username\s+String.*@unique/);
  });

  it('maps all DataTypes to Prisma types correctly', () => {
    const output = generatePrismaModel(allTypesSchema);
    expect(output).toContain('String');  // string
    expect(output).toContain('Float');   // number
    expect(output).toContain('Boolean'); // boolean
    expect(output).toContain('DateTime');// date
    expect(output).toContain('Json');    // json
  });

  it('emits @relation and relation field for FK columns', () => {
    const output = generatePrismaModel(fkSchema);
    expect(output).toContain('@relation');
    expect(output).toContain('fields: [author_id]');
    expect(output).toContain('references: [user_id]');
    // Relation field added for FK
    expect(output).toMatch(/users_rel\s+users/);
  });

  it('produces valid output for a schema with no FK', () => {
    const output = generatePrismaModel(simpleSchema);
    expect(output).not.toContain('@relation');
  });
});

// ── generateSQLTable ──────────────────────────────────────────────────────────

describe('generateSQLTable()', () => {
  it('opens with CREATE TABLE and the schema name', () => {
    const output = generateSQLTable(simpleSchema);
    expect(output).toMatch(/^CREATE TABLE users \(/);
  });

  it('closes with );', () => {
    const output = generateSQLTable(simpleSchema);
    expect(output).toContain(');');
  });

  it('emits PRIMARY KEY constraint for pkColumn', () => {
    const output = generateSQLTable(simpleSchema);
    expect(output).toContain('PRIMARY KEY (user_id)');
  });

  it('uses _id as PRIMARY KEY when no pkColumn is defined', () => {
    const schemaNoExplicitPK = defineTable({
      name: 'events',
      actor: 'admin',
      columns: { title: string().required() },
    });
    const output = generateSQLTable(schemaNoExplicitPK);
    expect(output).toContain('PRIMARY KEY (_id)');
  });

  it('adds NOT NULL for required columns', () => {
    const output = generateSQLTable(simpleSchema);
    expect(output).toMatch(/email VARCHAR\(255\) NOT NULL/);
  });

  it('omits NOT NULL for optional columns', () => {
    const output = generateSQLTable(simpleSchema);
    // age is optional → no NOT NULL
    expect(output).toMatch(/age DECIMAL\(10,2\)(?! NOT NULL)/);
  });

  it('maps all DataTypes to SQL types correctly', () => {
    const output = generateSQLTable(allTypesSchema);
    expect(output).toContain('VARCHAR(255)');  // string
    expect(output).toContain('DECIMAL(10,2)'); // number
    expect(output).toContain('BOOLEAN');       // boolean
    expect(output).toContain('DATETIME');      // date
    expect(output).toContain('JSON');          // json
  });

  it('emits FOREIGN KEY constraint for ref() columns', () => {
    const output = generateSQLTable(fkSchema);
    expect(output).toContain('FOREIGN KEY (author_id) REFERENCES users(user_id)');
  });

  it('produces valid output for a schema with no FK', () => {
    const output = generateSQLTable(simpleSchema);
    expect(output).not.toContain('FOREIGN KEY');
  });

  it('does not add NOT NULL to the same column twice for primary columns', () => {
    const output = generateSQLTable(simpleSchema);
    const pkLine = output.split('\n').find((l) => l.includes('user_id'));
    expect(pkLine).toBeDefined();
    // Should have exactly one NOT NULL
    const notNullCount = (pkLine!.match(/NOT NULL/g) || []).length;
    expect(notNullCount).toBe(1);
  });
});
