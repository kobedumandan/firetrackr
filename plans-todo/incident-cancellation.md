# Incident and dispatch cancellation

Implemented scope: administrators can cancel pending incidents with no dispatch
records. A reason is required; the status history retains the actor, server time,
and reason. Cancelled records remain in the incident register and can be archived.

Deferred implementation:

- Cancel one dispatch while retaining the incident's other assignments.
- Cancel an incident with dispatches, including all active assignments.
- Offer reasons such as false alarm, duplicate report, dispatched by mistake, and
  other, with additional details where needed.
- Notify assigned personnel and retain who cancelled, when, and why.
- Preserve return and readiness requirements for already deployed trucks.

Do not release deployed resources merely by changing their assignment status.
