import Handlebars from 'handlebars';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** All markup lives in email/templates/**.hbs (copied to dist via nest-cli.json assets). */
export const TEMPLATES_DIR =
  typeof __dirname !== 'undefined'
    ? join(__dirname, 'templates')
    : // jest ESM has no __dirname
      join(process.cwd(), 'src/modules/notification-delivery/email/templates');

export type EmailTemplates = Map<string, Handlebars.TemplateDelegate>;

/**
 * Compiles every template once. components/* become partials ({{> components/button}}).
 * strict: a missing variable throws; `{{x}}` escapes (only the layout body slot uses `{{{ }}}`).
 */
export function loadTemplates(dir: string = TEMPLATES_DIR): EmailTemplates {
  const hbs = Handlebars.create();
  const compiled: EmailTemplates = new Map();
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.hbs')) {
        const name = relative(dir, path).split(sep).join('/').replace(/\.hbs$/, '');
        const source = readFileSync(path, 'utf8');
        if (name.startsWith('components/')) hbs.registerPartial(name, source);
        compiled.set(name, hbs.compile(source, { strict: true }));
      }
    }
  };
  try {
    walk(dir);
  } catch {
    throw new Error(`Email templates directory missing or unreadable: ${dir} (check nest-cli.json assets)`);
  }
  if (!compiled.has('layout/base')) throw new Error('Email template layout/base.hbs is missing');
  return compiled;
}

/** Loaded once at startup; a missing file fails the boot with a clear message. */
export const TEMPLATES = loadTemplates();

export function render(templates: EmailTemplates, name: string, data: object): string {
  const template = templates.get(name);
  if (!template) throw new Error(`Email template not found: ${name}`);
  return template(data);
}
