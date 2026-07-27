/**
 * Application-specific errors.
 *
 * Implements: [HC-SDK-BOUNDARY] — every vendor exception is wrapped in one of
 * these before it leaves a provider module.
 */

export class TrajectoryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Configuration could not be loaded or validated. */
export class ConfigurationError extends TrajectoryError {}

/** No grounded recommendation can be assembled. */
export class InsufficientContextError extends TrajectoryError {}

/** A recommendation or principle contains invalid attribution. */
export class AttributionError extends TrajectoryError {}

/** A model provider is unavailable or failed. */
export class ProviderError extends TrajectoryError {}

/** A model provider returned invalid structured output. */
export class ProviderResponseError extends ProviderError {}
