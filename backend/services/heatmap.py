"""Shared severity scale for historical fire concentration."""


def severity_weight(severity: str | None) -> float:
    return {"minor": 0.4, "moderate": 0.7, "critical": 1.0}.get(
        (severity or "").strip().lower(), 0.5
    )
