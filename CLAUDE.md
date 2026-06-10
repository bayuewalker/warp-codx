# warp-codx

## graphify knowledge graph

This project has a pre-built knowledge graph at `graphify-out/`:
- `graph.json` — 2,088 nodes · 2,845 edges · 292 communities (GraphRAG-ready)
- `graph.html` — interactive force-directed visualization
- `GRAPH_REPORT.md` — plain-language architecture overview with god nodes

**Before answering any question about this codebase** — architecture, dependencies, feature implementation, "how does X work", "what calls Y", "where is Z defined" — run graphify query first:

```bash
graphify query "<your question>"          # broad BFS traversal
graphify query "<your question>" --dfs    # trace a specific path
graphify explain "<NodeName>"             # plain-language node explanation
graphify path "ConceptA" "ConceptB"       # shortest path between two concepts
```

Check `graphify-out/GRAPH_REPORT.md` for an overview of the top communities and god nodes (highest-betweenness bridge nodes).

To update after code changes: `graphify . --update` (the pre-commit hook does this automatically).
