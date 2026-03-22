import Ajv from 'ajv';
import type { ErrorObject } from 'ajv';

const ajv = new Ajv({ allErrors: true });

export type AjvErrorObject = Pick<
  ErrorObject,
  'instancePath' | 'message' | 'params' | 'keyword' | 'schemaPath'
>;

export type ValidationResult<T> =
  | { valid: true; data: T }
  | { valid: false; errors: AjvErrorObject[] };

/**
 * Validate `data` against a JSON Schema using AJV 8.x with `allErrors: true`.
 *
 * Returns `{valid: true, data: T}` on success or
 * `{valid: false, errors: AjvErrorObject[]}` on failure.
 */
export function validate<T>(schema: object, data: unknown): ValidationResult<T> {
  const validateFn = ajv.compile(schema);
  const valid = validateFn(data);

  if (valid) {
    return { valid: true, data: data as T };
  }

  const errors: AjvErrorObject[] = (validateFn.errors ?? []).map((e) => ({
    instancePath: e.instancePath,
    message: e.message ?? 'validation error',
    params: e.params,
    keyword: e.keyword,
    schemaPath: e.schemaPath,
  }));

  return { valid: false, errors };
}
