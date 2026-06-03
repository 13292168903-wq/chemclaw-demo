# ChemClaw Project Memory

## Project Overview
- **Name**: ChemClaw - Computational Chemistry Research Training Multi-Agent Teaching Assistant
- **Competition**: 郑州大学第一届"四创"大赛 专项赛 E3 教育创新应用赛
- **Deadline**: 2026-06-30

## OpenClaw Integration (completed 2026-06-03)
- Two Skills created and tested:
  - `chemclaw-analyze`: Parses Gaussian/ORCA output, generates chemical explanations and teaching materials (3-agent pipeline: data parsing → chemical explanation → teaching design)
  - `chemclaw-grade`: Grades student lab reports against 4-dimension rubric (data parsing 25%, concept explanation 30%, research design 25%, report expression 20%)
- Skills location: `~/.openclaw/workspace/skills/chemclaw-analyze/` and `chemclaw-grade/`
- Both Skills verified working via `openclaw skills list` (status: ✓ ready)
- User's OpenClaw: v2026.5.7, configured with Qwen3_6 model, also has Feishu channel

## Known Issues (from initial review)
- Sample data `diels-alder-ts.log` has some hand-crafted lines mixed with Gaussian output
- VASP parser not implemented (VASP references removed from 方案初稿)
- extractJSON function duplicated across 4 agent files
- No input size limits on API endpoints

## Architecture (OpenClaw-first)
- Backend: Node.js (server.js + src/) with OpenClaw bridge (src/openclaw-bridge.js)
- OpenClaw Bridge: wraps `openclaw agent --local` CLI → triggers Skills → returns AI responses
- Hybrid approach: OpenClaw (AI brain) + local parser (structured data: charts, 3D, metrics)
- Frontend: Vanilla HTML + Tailwind CDN + ES Modules (public/js/*.js) + Chinese UI
- OpenClaw Skills: Python scripts (chemclaw-analyze, chemclaw-grade)
- Knowledge base: concept cards, quiz templates, rubric dimensions
- All routes fall back to local/demo mode if OpenClaw is unavailable

## Frontend Refactoring (completed 2026-06-03)
- Broke 1000-line app.js into 7 ES modules in public/js/
- Tailwind CDN for utility classes + custom CSS for design tokens and complex components
- Dark/light mode toggle with localStorage persistence
- Chinese UI labels throughout
- Old monolithic app.js backed up as app.js.bak
- OpenClaw branding: 🦞 badge in status bar, skill tags in chat messages

## Mol* 3D Viewer & PDB Data Pipeline (completed 2026-06-03)
- Replaced 3Dmol.js with Mol* (molstar v5.9.0) via CDN for premium molecular visualization
- Mol* is the RCSB PDB next-gen viewer — dramatically better rendering quality
- PDB data pipeline: OpenClaw Skill (analyze.py) → generates PDB with CONECT → backend passes to frontend → Mol* renders
- Key insight: XYZ has no bond info, PDB with CONECT gives correct bonds → OpenClaw enables better visualization
- viewer.js: initMoleculeViewer() uses molstar.Viewer.create(), loadMoleculeToViewer() uses Blob URL
- Backend orchestrator.js: added xyzToPdb() with ATOM + CONECT generation
- Frontend prefers pdbData from backend (from OpenClaw) over raw XYZ for better rendering
- Viewer Info Bar shows: engine tag, atom/bond counts, "🦞 OpenClaw 提供结构数据" badge

## User Preferences
- All code/output must be in English, no Chinese characters
- Markdown format for copy-paste convenience
- Wants "ready to use" complete solutions
