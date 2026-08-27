/**
 * The named validators a driver's form schema can reference.
 *
 * A descriptor names a validator rather than shipping a regex, so validation
 * logic stays in code review instead of travelling as data. A driver that
 * needs a check nothing here covers registers one.
 */
export type Validator = (value: string) => boolean

const builtin: Record<string, Validator> = {
  /** Non-empty after trimming. */
  required: (value) => value.trim() !== '',
  /** A positive integer. */
  'int-range': (value) => /^\d+$/.test(value.trim()),
  /** An http or https URL. */
  url: (value) => /^https?:\/\/\S+$/i.test(value.trim()),
}

const registered = new Map<string, Validator>(Object.entries(builtin))

/** Adds a family-specific check, such as RocketMQ's address format. */
export function registerValidator(name: string, validate: Validator): void {
  registered.set(name, validate)
}

/**
 * Runs a named validator.
 *
 * An unknown name passes rather than failing: a descriptor naming a validator
 * this build does not have should not make the field unfillable, and the
 * backend validates again anyway.
 */
export function validate(name: string | undefined, value: string): boolean {
  if (!name) return true
  const validator = registered.get(name)
  return validator ? validator(value) : true
}
