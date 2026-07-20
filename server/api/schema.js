import { ApiError } from "./errors.js";

function validateSchema(schema, value, { path = "$", required = true } = {}) {
  const issues = [];
  validateValue(schema, value, path, required, issues);
  if (issues.length) {
    throw new ApiError(400, "VALIDATION_ERROR", "请求数据校验失败", { details: issues });
  }
  return value;
}

function validateValue(schema, value, path, required, issues) {
  const normalized = normalizeSchema(schema);
  if (value === undefined) {
    if (required && !normalized.optional) issues.push({ path, message: "缺少必填值" });
    return;
  }
  if (value === null) {
    if (!normalized.nullable) issues.push({ path, message: "不能为 null" });
    return;
  }

  if (normalized.enum && !normalized.enum.includes(value)) {
    issues.push({ path, message: "不在允许值范围内" });
    return;
  }

  const type = normalized.type;
  if (!matchesType(type, value)) {
    issues.push({ path, message: `应为 ${typeLabel(type)}` });
    return;
  }

  if (type === "string") validateStringConstraints(normalized, value, path, issues);
  if (type === "number" || type === "integer") validateNumberConstraints(normalized, value, path, issues);

  if (type === "object" && normalized.properties) {
    const hasExplicitRequired = Array.isArray(normalized.required);
    const requiredNames = new Set(normalized.required || []);
    for (const [rawName, childSchema] of Object.entries(normalized.properties)) {
      const name = rawName.replace(/\?$/, "");
      const child = normalizeSchema(childSchema);
      const childRequired = hasExplicitRequired
        ? requiredNames.has(name)
        : !(rawName.endsWith("?") || child.optional);
      validateValue(childSchema, value[name], `${path}.${name}`, childRequired, issues);
    }
    if (normalized.additionalProperties === false) {
      const allowed = new Set(Object.keys(normalized.properties).map((name) => name.replace(/\?$/, "")));
      Object.keys(value).forEach((name) => {
        if (!allowed.has(name)) issues.push({ path: `${path}.${name}`, message: "不允许的字段" });
      });
    }
  }

  if (type === "array" && normalized.items) {
    value.forEach((item, index) => validateValue(normalized.items, item, `${path}[${index}]`, true, issues));
  }
  if (type === "array") {
    if (Number.isSafeInteger(normalized.minItems) && value.length < normalized.minItems) issues.push({ path, message: `至少需要 ${normalized.minItems} 项` });
    if (Number.isSafeInteger(normalized.maxItems) && value.length > normalized.maxItems) issues.push({ path, message: `最多允许 ${normalized.maxItems} 项` });
  }
}

function validateStringConstraints(schema, value, path, issues) {
  if (Number.isSafeInteger(schema.minLength) && value.length < schema.minLength) issues.push({ path, message: `长度不能少于 ${schema.minLength}` });
  if (Number.isSafeInteger(schema.maxLength) && value.length > schema.maxLength) issues.push({ path, message: `长度不能超过 ${schema.maxLength}` });
  if (schema.pattern) {
    let pattern;
    try {
      pattern = new RegExp(schema.pattern);
    } catch {
      throw new TypeError(`无效的 schema pattern：${schema.pattern}`);
    }
    if (!pattern.test(value)) issues.push({ path, message: "格式不符合要求" });
  }
}

function validateNumberConstraints(schema, value, path, issues) {
  if (Number.isFinite(schema.minimum) && value < schema.minimum) issues.push({ path, message: `不能小于 ${schema.minimum}` });
  if (Number.isFinite(schema.maximum) && value > schema.maximum) issues.push({ path, message: `不能大于 ${schema.maximum}` });
}

function normalizeSchema(schema) {
  if (Array.isArray(schema)) {
    return { type: "array", items: schema[0] || "object", optional: false, nullable: false };
  }
  if (schema && typeof schema === "object") {
    if (isExplicitSchema(schema)) {
      return {
        ...schema,
        type: schema.type || inferExplicitType(schema),
        optional: Boolean(schema.optional),
        nullable: Boolean(schema.nullable),
      };
    }
    return {
      type: "object",
      properties: schema,
      optional: false,
      nullable: false,
    };
  }

  const raw = String(schema || "string");
  return {
    type: raw.replace(/\?$/, ""),
    optional: raw.endsWith("?"),
    nullable: false,
  };
}

function isExplicitSchema(schema) {
  return [
    "type", "properties", "items", "enum", "nullable", "additionalProperties", "required",
    "maxItems", "maxLength", "maximum", "minItems", "minLength", "minimum", "pattern",
  ]
    .some((key) => Object.hasOwn(schema, key));
}

function inferExplicitType(schema) {
  if (schema.properties) return "object";
  if (schema.items) return "array";
  return "string";
}

function matchesType(type, value) {
  if (type === "any") return true;
  if (type === "object") return typeof value === "object" && !Array.isArray(value) && !Buffer.isBuffer(value);
  if (type === "array") return Array.isArray(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "boolean") return typeof value === "boolean";
  if (type === "binary") return Buffer.isBuffer(value) || value instanceof Uint8Array;
  return typeof value === "string";
}

function typeLabel(type) {
  return ({
    any: "任意值",
    array: "数组",
    binary: "二进制数据",
    boolean: "布尔值",
    integer: "整数",
    number: "数字",
    object: "对象",
    string: "字符串",
  })[type] || type;
}

function toOpenApiSchema(schema) {
  const normalized = normalizeSchema(schema);
  const result = {};
  if (normalized.type === "binary") {
    result.type = "string";
    result.format = "binary";
  } else if (normalized.type !== "any") {
    result.type = normalized.type;
  }
  if (normalized.nullable) result.nullable = true;
  if (normalized.enum) result.enum = [...normalized.enum];
  if (normalized.description) result.description = normalized.description;
  if (normalized.format && normalized.type !== "binary") result.format = normalized.format;
  ["maxItems", "maxLength", "maximum", "minItems", "minLength", "minimum", "pattern"].forEach((name) => {
    if (normalized[name] != null) result[name] = normalized[name];
  });

  if (normalized.type === "array") {
    result.items = toOpenApiSchema(normalized.items || "object");
  }
  if (normalized.type === "object" && normalized.properties) {
    const properties = {};
    const required = [];
    const hasExplicitRequired = Array.isArray(normalized.required);
    const explicitRequired = new Set(normalized.required || []);
    for (const [rawName, childSchema] of Object.entries(normalized.properties)) {
      const name = rawName.replace(/\?$/, "");
      const child = normalizeSchema(childSchema);
      properties[name] = toOpenApiSchema(childSchema);
      const childRequired = hasExplicitRequired
        ? explicitRequired.has(name)
        : !(rawName.endsWith("?") || child.optional);
      if (childRequired) required.push(name);
    }
    result.properties = properties;
    if (required.length) result.required = required;
    if (normalized.additionalProperties === false) result.additionalProperties = false;
  }
  return result;
}

export { normalizeSchema, toOpenApiSchema, validateSchema };
