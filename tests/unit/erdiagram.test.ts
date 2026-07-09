import { generateMermaidERDiagram } from '../../src/cli/commands/erdiagram';
import { defineTable } from '../../src/schema/defineTable';
import { string, number, boolean } from '../../src/schema/columnBuilder';

const usersSchema = defineTable({
  name: 'users',
  actor: 'admin',
  columns: {
    user_id: string().primary(),
    email: string().required().unique(),
    age: number(),
  },
});

const postsSchema = defineTable({
  name: 'posts',
  actor: 'user',
  columns: {
    post_id: string().primary(),
    author_id: string().required().ref('users.user_id'),
    title: string().required(),
    published: boolean(),
  },
});

const profilesSchema = defineTable({
  name: 'profiles',
  actor: 'user',
  columns: {
    profile_id: string().primary(),
    user_id: string().required().unique().ref('users.user_id'),
  },
});

const danglingRefSchema = defineTable({
  name: 'comments',
  actor: 'user',
  columns: {
    comment_id: string().primary(),
    post_id: string().required().ref('posts.post_id'),
    ghost_id: string().ref('not_registered.id'),
  },
});

describe('generateMermaidERDiagram()', () => {
  it('opens with erDiagram', () => {
    const output = generateMermaidERDiagram([usersSchema]);
    expect(output).toMatch(/^erDiagram/);
  });

  it('emits an entity block per schema with its name', () => {
    const output = generateMermaidERDiagram([usersSchema, postsSchema]);
    expect(output).toContain('users {');
    expect(output).toContain('posts {');
  });

  it('marks the explicit pkColumn as PK', () => {
    const output = generateMermaidERDiagram([usersSchema]);
    expect(output).toMatch(/string\s+user_id\s+PK/);
  });

  it('falls back to _id as PK when no primary() column is declared', () => {
    const noPkSchema = defineTable({
      name: 'events',
      actor: 'admin',
      columns: { title: string().required() },
    });
    const output = generateMermaidERDiagram([noPkSchema]);
    expect(output).toMatch(/string\s+_id\s+PK/);
  });

  it('marks unique non-PK columns as UK', () => {
    const output = generateMermaidERDiagram([usersSchema]);
    expect(output).toMatch(/string\s+email\s+UK/);
  });

  it('marks ref() columns as FK, taking priority over UK when both apply', () => {
    const output = generateMermaidERDiagram([usersSchema, postsSchema, profilesSchema]);
    expect(output).toMatch(/string\s+author_id\s+FK/);
    // profiles.user_id is both unique() and ref() — FK should win over UK.
    // Isolate the block for `profiles` specifically since `users` also has a `user_id` column.
    const profilesBlock = output.slice(output.indexOf('profiles {'), output.indexOf('    }', output.indexOf('profiles {')));
    const profileUserIdLine = profilesBlock.split('\n').find((l) => l.trim().startsWith('string user_id'));
    expect(profileUserIdLine).toContain('FK');
    expect(profileUserIdLine).not.toContain('UK');
  });

  it('emits a plain column line with no marker for non-key columns', () => {
    const output = generateMermaidERDiagram([usersSchema]);
    expect(output).toMatch(/^\s+number age\s*$/m);
  });

  it('emits a one-to-many relationship line for a non-unique FK', () => {
    const output = generateMermaidERDiagram([usersSchema, postsSchema]);
    expect(output).toContain('users ||--o{ posts : "author_id"');
  });

  it('emits a one-to-one relationship line for a unique FK', () => {
    const output = generateMermaidERDiagram([usersSchema, profilesSchema]);
    expect(output).toContain('users ||--|| profiles : "user_id"');
  });

  it('skips relationship lines for ref() targets not present in the schema set', () => {
    const output = generateMermaidERDiagram([postsSchema, danglingRefSchema]);
    expect(output).not.toContain('not_registered');
    expect(output).toContain('posts ||--o{ comments : "post_id"');
  });

  it('produces no relationship section when there are no ref() columns', () => {
    const output = generateMermaidERDiagram([usersSchema]);
    expect(output).not.toMatch(/\|\|--/);
  });

  it('handles an empty schema list', () => {
    const output = generateMermaidERDiagram([]);
    expect(output).toBe('erDiagram');
  });
});
