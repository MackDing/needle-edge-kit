// Lightweight argument validator against tools/my_tools.json schema.
// Reads schema lazily (bundled as require()).

import toolsSchema from '../../tools/example_tools.json';

type Param = {
  type: 'string' | 'integer' | 'number' | 'boolean';
  enum?: string[];
  description?: string;
};

type ToolDef = {
  name: string;
  description: string;
  parameters: Record<string, Param>;
  required: string[];
};

const schemas: Record<string, ToolDef> = Object.fromEntries(
  (toolsSchema as ToolDef[]).map((t) => [t.name, t]),
);

export function validateArgs(toolName: string, args: Record<string, any>): string | null {
  const def = schemas[toolName];
  if (!def) return `no schema for ${toolName}`;

  for (const req of def.required) {
    if (args[req] === undefined) return `missing required: ${req}`;
  }

  for (const [key, val] of Object.entries(args)) {
    const spec = def.parameters[key];
    if (!spec) return `unknown arg: ${key}`;

    if (spec.type === 'string' && typeof val !== 'string') return `${key} must be string`;
    if (spec.type === 'integer' && !Number.isInteger(val)) return `${key} must be integer`;
    if (spec.type === 'number' && typeof val !== 'number') return `${key} must be number`;
    if (spec.type === 'boolean' && typeof val !== 'boolean') return `${key} must be boolean`;

    if (spec.enum && spec.type === 'string' && !spec.enum.includes(val as string)) {
      return `${key} must be one of: ${spec.enum.join(', ')}`;
    }
  }

  return null;
}
