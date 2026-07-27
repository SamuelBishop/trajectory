"""Application-specific errors."""


class TrajectoryError(Exception):
    """Base class for expected user-facing failures."""


class ConfigurationError(TrajectoryError):
    """Configuration could not be loaded or validated."""


class InsufficientContextError(TrajectoryError):
    """No grounded recommendation can be assembled."""


class AttributionError(TrajectoryError):
    """A recommendation or principle contains invalid attribution."""


class ProviderError(TrajectoryError):
    """A model provider is unavailable or failed."""


class ProviderResponseError(ProviderError):
    """A model provider returned invalid structured output."""
