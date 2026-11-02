import { describe, expect, it } from 'vitest';
import { loginSchema, registerSchema } from './auth';
import { createProjectSchema } from './projects';
import { createWebsiteSchema } from './websites';

const messages = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe('registerSchema', () => {
  const valid = { name: 'Asha', email: ' Asha@Example.COM ', password: 'correct horse battery' };

  it('accepts valid input and normalizes the email', () => {
    expect(registerSchema.parse(valid).email).toBe('asha@example.com');
  });

  it('rejects short passwords', () => {
    expect(messages(registerSchema.safeParse({ ...valid, password: 'short' }))).toContain(
      'Use at least 10 characters.',
    );
  });

  it('rejects common passwords', () => {
    const result = registerSchema.safeParse({ ...valid, password: 'Password123' });
    expect(messages(result)[0]).toMatch(/too common/);
  });

  it('rejects a password equal to the email', () => {
    const result = registerSchema.safeParse({
      ...valid,
      email: 'longemail@x.io',
      password: 'longemail@x.io',
    });
    expect(messages(result)[0]).toMatch(/must not be your email/);
  });

  it('rejects invalid emails', () => {
    expect(messages(registerSchema.safeParse({ ...valid, email: 'nope' }))).toContain(
      'Enter a valid email address.',
    );
  });
});

describe('loginSchema', () => {
  it('requires a password but applies no strength rules', () => {
    expect(loginSchema.safeParse({ email: 'a@b.co', password: 'x' }).success).toBe(true);
    expect(loginSchema.safeParse({ email: 'a@b.co', password: '' }).success).toBe(false);
  });
});

describe('createProjectSchema', () => {
  it('trims and limits the name', () => {
    expect(createProjectSchema.parse({ name: '  Shop  ' }).name).toBe('Shop');
    expect(createProjectSchema.safeParse({ name: 'x' }).success).toBe(false);
  });
});

describe('createWebsiteSchema', () => {
  const valid = {
    projectId: 'p1',
    name: 'Homepage',
    baseUrl: 'https://example.com',
    authorizationConfirmed: true,
  };

  it('accepts a valid website', () => {
    expect(createWebsiteSchema.safeParse(valid).success).toBe(true);
  });

  it('requires the authorization confirmation', () => {
    const result = createWebsiteSchema.safeParse({ ...valid, authorizationConfirmed: false });
    expect(messages(result)[0]).toMatch(/authorized to test/);
  });

  it('rejects unsafe URLs', () => {
    expect(createWebsiteSchema.safeParse({ ...valid, baseUrl: 'http://localhost' }).success).toBe(
      false,
    );
  });

  it('limits crawl settings', () => {
    expect(createWebsiteSchema.safeParse({ ...valid, maxPages: 1000 }).success).toBe(false);
    expect(createWebsiteSchema.safeParse({ ...valid, excludePatterns: ['blog'] }).success).toBe(
      false,
    );
  });
});
