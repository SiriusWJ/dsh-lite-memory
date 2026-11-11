/**
 * 自带 defineTool（不再动态解析 @deepseek-ai/dsh-tools）。
 *
 * 为什么不 import 官方的 defineTool：
 *  - DSH 0.2.x 桌面版把 dsh-tools 打进 app.asar，插件里 createRequire(...).resolve()
 *    之后 import(asar 路径) 不保证成立（0.2.2-rc.1 实测解析不到，工具静默丢失）；
 *  - 从 profile 的 node_modules 解析到镜像副本更糟：会让整个 base 层用错工具注册表
 *    （dsh-taskboard 的 sdk.js 就是为此改成自带的）。
 *
 * 这里按 dsh-tools 官方 defineTool 的语义实现等价子集：
 *  - 属性级 `required: true` 收集成对象级 required 数组；
 *  - 输出 value schema 原样透传（调用方只传合法 JSON Schema）；
 *  - execute 前按同一 schema 预校验参数，错误格式与官方 ToolArgsError 对齐。
 */

/** 编译单个值 spec（json 为仅注释节点，与官方一致）。 */
export function compileValueSpec(spec) {
  const node = {}
  if (typeof spec.description === 'string' && spec.description.length > 0) node.description = spec.description
  const type = spec.type
  if (type === undefined || type === 'json') return node
  if (type === 'array') {
    node.type = 'array'
    if (spec.items !== undefined) node.items = compileValueSpec(spec.items)
    return node
  }
  if (type === 'object') {
    node.type = 'object'
    if (spec.additionalProperties !== undefined) node.additionalProperties = spec.additionalProperties
    if (spec.properties !== undefined) node.properties = compileParamSpecs(spec.properties).properties
    return node
  }
  node.type = type
  if (spec.enum !== undefined) node.enum = [...spec.enum]
  return node
}

/** 编译属性表：properties + 收集到的 required 列表。 */
export function compileParamSpecs(parameters) {
  const properties = {}
  const required = []
  for (const [key, spec] of Object.entries(parameters)) {
    const { required: isRequired, ...valueSpec } = spec
    properties[key] = compileValueSpec(valueSpec)
    if (isRequired === true) required.push(key)
  }
  return required.length > 0
    ? { type: 'object', properties, required }
    : { type: 'object', properties }
}

function matchesScalarType(value, type) {
  switch (type) {
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number'
    case 'integer': return typeof value === 'number' && Number.isInteger(value)
    case 'boolean': return typeof value === 'boolean'
    case 'null': return value === null
    default: return true
  }
}

/** 按编译后的 JSON Schema 子集校验，返回带路径的违规描述。 */
export function collectViolations(schema, value, path) {
  if (typeof schema.type !== 'string' || schema.type.length === 0) return []
  if (schema.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [path + ' must be an object']
    const violations = []
    for (const key of schema.required || []) if (!(key in value)) violations.push(path + '.' + key + ' is required')
    for (const [key, child] of Object.entries(schema.properties || {})) {
      if (key in value) violations.push(...collectViolations(child, value[key], path + '.' + key))
    }
    return violations
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return [path + ' must be an array']
    const violations = []
    if (schema.items !== undefined) {
      value.forEach((item, index) => { violations.push(...collectViolations(schema.items, item, path + '[' + index + ']')) })
    }
    return violations
  }
  if (!matchesScalarType(value, schema.type)) return [path + ' must be ' + schema.type]
  if (schema.enum !== undefined && !schema.enum.some((candidate) => candidate === value)) {
    return [path + ' must be one of ' + schema.enum.map(String).join(', ')]
  }
  return []
}

/** 返回与官方同形的 defineTool。 */
export function makeDefineTool() {
  return function defineTool(options) {
    const parameters = compileParamSpecs(options.parameters || {})
    const userRender = options.output && options.output.render
    return {
      name: options.name,
      description: options.description,
      parameters,
      output: {
        schema: (options.output && options.output.schema) || {},
        render(args, value) {
          if (typeof userRender === 'function') return userRender(args, value)
          return [{ type: 'text', text: String(value) }]
        },
      },
      async execute(args, exec) {
        const violations = collectViolations(parameters, args, 'arguments')
        if (violations.length > 0) throw new Error('Error: invalid arguments: ' + violations.join('; '))
        return options.execute(args, exec)
      },
    }
  }
}
