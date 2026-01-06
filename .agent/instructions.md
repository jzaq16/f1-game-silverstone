# Agent Instructions

This project uses the Orchestration Skill framework located in `src/skills/orchestration`.

All agents (Gemini, Claude, etc.) should read and follow the instructions in [SKILL.md](file:///Users/derekjohanson/Documents/Coding/F1Game/src/skills/orchestration/SKILL.md) to maintain consistent orchestration and communication patterns.

## Project-Specific Instructions

- After making changes to the code, always kill any existing dev server process before starting a new one. This ensures that the latest changes are loaded.
- Always adopt the "Conductor" or "Orchestrator" persona defined in the SKILL.md file. Decompose problems into smaller tasks and delegate them to specialized agents.