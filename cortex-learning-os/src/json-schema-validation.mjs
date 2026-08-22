import fs from 'node:fs';
import path from 'node:path';

function typeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object'
    && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function pointer(document, fragment) {
  if (fragment === '' || fragment === '#') return document;
  if (!fragment.startsWith('#/')) throw new Error(`unsupported JSON-Schema fragment: ${fragment}`);
  return fragment.slice(2).split('/').reduce((value, token) => (
    value[token.replaceAll('~1', '/').replaceAll('~0', '~')]
  ), document);
}

function schemaDocument(schemaPath, cache) {
  const resolved = path.resolve(schemaPath);
  if (!cache.has(resolved)) {
    cache.set(resolved, JSON.parse(fs.readFileSync(resolved, 'utf8')));
  }
  return { path: resolved, schema: cache.get(resolved), cache };
}

function validate(value, schema, context, location, errors) {
  if (schema === true) return;
  if (schema === false) {
    errors.push(`${location}: schema forbids this value`);
    return;
  }
  if (schema.$ref) {
    const [referencePath, fragment = ''] = schema.$ref.split('#', 2);
    const target = referencePath === ''
      ? context
      : schemaDocument(path.resolve(path.dirname(context.path), referencePath), context.cache);
    validate(value, pointer(target.schema, fragment === '' ? '' : `#${fragment}`), target, location, errors);
    return;
  }
  if (Array.isArray(schema.allOf)) {
    for (const nested of schema.allOf) validate(value, nested, context, location, errors);
  }
  if (Array.isArray(schema.oneOf)) {
    const branches = schema.oneOf.map((nested) => {
      const branchErrors = [];
      validate(value, nested, context, location, branchErrors);
      return branchErrors;
    });
    const matches = branches.filter((branch) => branch.length === 0).length;
    if (matches !== 1) errors.push(`${location}: expected exactly one oneOf branch, observed ${matches}`);
  }
  if (schema.if) {
    const conditionErrors = [];
    validate(value, schema.if, context, location, conditionErrors);
    if (conditionErrors.length === 0 && schema.then) {
      validate(value, schema.then, context, location, errors);
    } else if (conditionErrors.length > 0 && schema.else) {
      validate(value, schema.else, context, location, errors);
    }
  }
  if (schema.const !== undefined
      && JSON.stringify(value) !== JSON.stringify(schema.const)) {
    errors.push(`${location}: value differs from const`);
  }
  if (Array.isArray(schema.enum)
      && !schema.enum.some((candidate) => JSON.stringify(candidate) === JSON.stringify(value))) {
    errors.push(`${location}: value is not in enum`);
  }
  const types = schema.type === undefined
    ? []
    : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types.length > 0 && !types.some((type) => typeMatches(value, type))) {
    errors.push(`${location}: type mismatch`);
    return;
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${location}: string is shorter than minLength`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${location}: string is longer than maxLength`);
    }
    if (schema.pattern !== undefined && !(new RegExp(schema.pattern, 'u')).test(value)) {
      errors.push(`${location}: string does not match pattern`);
    }
    if (schema.format === 'date-time') {
      const timestamp = Date.parse(value);
      if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) {
        errors.push(`${location}: string is not a canonical date-time`);
      }
    }
    if (schema.contentEncoding === 'base64') {
      const decoded = Buffer.from(value, 'base64');
      if (decoded.toString('base64') !== value) errors.push(`${location}: string is not canonical base64`);
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${location}: number is below minimum`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${location}: number is above maximum`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${location}: array is shorter than minItems`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${location}: array is longer than maxItems`);
    }
    if (schema.uniqueItems === true
        && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) {
      errors.push(`${location}: array items are not unique`);
    }
    const prefixCount = Array.isArray(schema.prefixItems) ? schema.prefixItems.length : 0;
    for (let index = 0; index < prefixCount && index < value.length; index += 1) {
      validate(value[index], schema.prefixItems[index], context, `${location}/${index}`, errors);
    }
    if (schema.items !== undefined) {
      for (let index = prefixCount; index < value.length; index += 1) {
        validate(value[index], schema.items, context, `${location}/${index}`, errors);
      }
    }
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (schema.minProperties !== undefined && keys.length < schema.minProperties) {
      errors.push(`${location}: object has fewer than minProperties`);
    }
    if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) {
      errors.push(`${location}: object has more than maxProperties`);
    }
    for (const required of schema.required || []) {
      if (!Object.hasOwn(value, required)) errors.push(`${location}: missing required property ${required}`);
    }
    for (const key of keys) {
      if (schema.propertyNames) {
        validate(key, schema.propertyNames, context, `${location}/<propertyName>`, errors);
      }
      if (schema.properties && Object.hasOwn(schema.properties, key)) {
        validate(value[key], schema.properties[key], context, `${location}/${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${location}: unknown property ${key}`);
      } else if (schema.additionalProperties
          && typeof schema.additionalProperties === 'object') {
        validate(
          value[key],
          schema.additionalProperties,
          context,
          `${location}/${key}`,
          errors,
        );
      }
    }
  }
}

export function validateJsonSchema(value, schemaPath) {
  const cache = new Map();
  const context = {
    ...schemaDocument(schemaPath, cache),
    cache,
  };
  const errors = [];
  validate(value, context.schema, context, '$', errors);
  return { ok: errors.length === 0, errors };
}
