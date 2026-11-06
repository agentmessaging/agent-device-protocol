# Source note: user request

- Captured: 2026-11-06 (America/Denver).
- Source: repository owner's conversation accompanying this documentation task; summary, not a verbatim transcript.
- Preserve this note after ingestion. Add follow-up notes for changed requirements.

The owner wants a recognizable agent avatar across devices with different display sizes and capabilities, similar to the Muse gadget experience. The preceding discussion distinguished local avatar assets/animation from transport of agent state; the existing Maestro display has an activity orb and camera PiP, not a portable avatar package.

The current request is to write backlog and specifications for that feature and the newly reported device problem, without code changes. Backlog, specs and supporting knowledge must live in the repository. If no internal work system exists, adapt the Karpathy wiki approach. Earlier decisions remain: one assigned agent per device, reassignment permitted, one active device per agent, and one host controller may serve many agents. Future implementations should have one branch/PR per issue or tightly connected work item.

This note does not authorize deploying a renderer, changing device grants, generating final Lola artwork or declaring issue #20 fixed.
