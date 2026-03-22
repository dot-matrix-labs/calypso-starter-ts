import { test, expect, describe } from 'vitest';
import { validate } from '../../src/api/validation';
import { createTaskSchema, registerUserSchema, patchTaskSchema } from 'core';

describe('validate()', () => {
  test('returns valid:true with typed data when input matches schema', () => {
    const result = validate<{ name: string }>(createTaskSchema, { name: 'My task' });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.data.name).toBe('My task');
    }
  });

  test('returns valid:false with errors when required field is missing', () => {
    const result = validate(createTaskSchema, { priority: 'low' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0);
      const messages = result.errors.map((e) => e.message);
      expect(messages.some((m) => m?.includes("must have required property 'name'"))).toBe(true);
    }
  });

  test('returns valid:false with errors for invalid enum value', () => {
    const result = validate(createTaskSchema, { name: 'Task', priority: 'urgent' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0);
      const paths = result.errors.map((e) => e.instancePath);
      expect(paths.some((p) => p === '/priority')).toBe(true);
    }
  });

  test('collects all errors (allErrors: true) when multiple fields are invalid', () => {
    const result = validate(createTaskSchema, {
      name: '',
      priority: 'invalid',
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      // Should have errors for both name (minLength) and priority (enum)
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    }
  });

  test('allows optional fields to be absent', () => {
    const result = validate<{ name: string }>(createTaskSchema, { name: 'Minimal task' });
    expect(result.valid).toBe(true);
  });

  test('returns valid:false for additional properties when additionalProperties:false', () => {
    const result = validate(createTaskSchema, { name: 'Task', unknownField: 'oops' });
    expect(result.valid).toBe(false);
  });

  test('registerUserSchema: valid input passes', () => {
    const result = validate<{ username: string; password: string }>(registerUserSchema, {
      username: 'alice',
      password: 'secret123',
    });
    expect(result.valid).toBe(true);
  });

  test('registerUserSchema: missing username fails', () => {
    const result = validate(registerUserSchema, { password: 'secret123' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const messages = result.errors.map((e) => e.message);
      expect(messages.some((m) => m?.includes("must have required property 'username'"))).toBe(
        true,
      );
    }
  });

  test('registerUserSchema: short password fails', () => {
    const result = validate(registerUserSchema, { username: 'alice', password: 'abc' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const paths = result.errors.map((e) => e.instancePath);
      expect(paths.some((p) => p === '/password')).toBe(true);
    }
  });

  test('patchTaskSchema: valid partial patch passes', () => {
    const result = validate(patchTaskSchema, { status: 'done' });
    expect(result.valid).toBe(true);
  });

  test('patchTaskSchema: invalid status enum fails', () => {
    const result = validate(patchTaskSchema, { status: 'completed' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const paths = result.errors.map((e) => e.instancePath);
      expect(paths.some((p) => p === '/status')).toBe(true);
    }
  });

  test('error objects include instancePath and message', () => {
    const result = validate(createTaskSchema, {});
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const err = result.errors[0];
      expect(err).toHaveProperty('instancePath');
      expect(err).toHaveProperty('message');
    }
  });
});
