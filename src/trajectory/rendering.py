"""Render validated recommendations for terminal users."""

from trajectory.domain import ChatResponse, Recommendation


def confidence_label(confidence: float) -> str:
    if confidence >= 0.75:
        return "High"
    if confidence >= 0.5:
        return "Moderate"
    return "Low"


def render_recommendation(recommendation: Recommendation) -> str:
    grounding = [
        *recommendation.goal_ids,
        *recommendation.principle_ids,
        *recommendation.source_ids,
    ]
    inference = recommendation.inferences[0]
    uncertainty = recommendation.uncertainties[0]
    return "\n".join(
        [
            f"Assessment: {recommendation.response}",
            "",
            recommendation.why_now,
            f"Inference: {inference}",
            "",
            f"Next: {recommendation.suggested_next_step}",
            "",
            f"Confidence: {confidence_label(recommendation.confidence)}",
            f"Uncertainty: {uncertainty}",
            f"Grounding: {' | '.join(grounding)}",
        ]
    )


def render_chat_response(response: ChatResponse) -> str:
    lines = [response.answer]
    if response.uncertainties:
        lines.extend(["", f"Uncertainty: {response.uncertainties[0]}"])
    lines.append(
        "Grounding: "
        + " | ".join([*response.goal_ids, *response.principle_ids, *response.source_ids])
    )
    return "\n".join(lines)
